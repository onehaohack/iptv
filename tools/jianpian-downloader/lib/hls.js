// m3u8 解析：区分 master（带码率档位）和 media（直接是分片列表）。
// 荐片的两类线路都实测存在，必须都支持。

const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024

function parseVariantLines(text) {
  const lines = text.split('\n').map(l => l.trim())
  const variants = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue
    const attrs = lines[i].slice(lines[i].indexOf(':') + 1)
    const bandwidth = Number((/BANDWIDTH=(\d+)/.exec(attrs) || [])[1]) || 0
    const resolutionMatch = /RESOLUTION=(\d+)x(\d+)/.exec(attrs)
    const next = lines.slice(i + 1).find(l => l && !l.startsWith('#'))
    if (!next) continue
    variants.push({
      bandwidth,
      width: resolutionMatch ? Number(resolutionMatch[1]) : null,
      height: resolutionMatch ? Number(resolutionMatch[2]) : null,
      uri: next
    })
    i = lines.indexOf(next, i)
  }
  return variants
}

function parseSegments(text, baseUrl) {
  const out = []
  let duration = 0
  let pendingDuration = null
  let encrypted = false
  let keyUrl = null
  let explicitIv = null
  let discontinuityCount = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXT-X-KEY')) {
      const method = (/METHOD=([^,]+)/.exec(line) || [])[1] || ''
      // 实测荐片有三种：无 KEY、METHOD=NONE（显式声明明文）、METHOD=AES-128（key 是相对路径的 .key 文件）。
      if (method === 'NONE' || method === '') {
        continue
      }
      if (method === 'AES-128') {
        encrypted = true
        const uri = (/URI="([^"]+)"/.exec(line) || [])[1]
        if (uri) {
          try {
            keyUrl = new URL(uri, baseUrl).href
          } catch { /* key 地址异常时留空，由上层判定不可解密 */ }
        }
        const iv = (/IV=([0-9a-fA-Fx]+)/.exec(line) || [])[1]
        if (iv) explicitIv = iv
      } else {
        encrypted = true // SAMPLE-AES 等其它方式，本地无法解密
      }
      continue
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuityCount++
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number((/EXTINF:([\d.]+)/.exec(line) || [])[1]) || 0
      continue
    }
    if (line.startsWith('#')) continue

    let uri
    try {
      uri = new URL(line, baseUrl).href
    } catch {
      continue
    }
    out.push({ uri, duration: pendingDuration || 0 })
    duration += pendingDuration || 0
    pendingDuration = null
  }

  return { segments: out, duration, encrypted, keyUrl, explicitIv, discontinuityCount }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': require('./jianpian').UA },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_PLAYLIST_BYTES) throw new Error('播放列表异常过大')
  return text
}

// 返回 { segments, duration, variant, encrypted, keyUrl }
async function resolvePlaylist(url) {
  const text = await fetchText(url)
  const variants = parseVariantLines(text)

  let targetUrl = url
  let variant = null

  if (variants.length > 0) {
    variants.sort((a, b) => b.bandwidth - a.bandwidth)
    variant = variants[0]
    targetUrl = new URL(variant.uri, url).href
    const mediaText = await fetchText(targetUrl)
    const parsed = parseSegments(mediaText, targetUrl)
    if (parsed.segments.length === 0) throw new Error('播放列表没有分片')
    return { ...parsed, variant, playlistUrl: targetUrl }
  }

  const parsed = parseSegments(text, url)
  if (parsed.segments.length === 0) throw new Error('播放列表没有分片')
  return { ...parsed, variant: null, playlistUrl: url }
}

module.exports = { resolvePlaylist, parseVariantLines, parseSegments }
