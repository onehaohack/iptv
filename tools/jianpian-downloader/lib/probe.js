// 线路体检：并发探测每条线路的可用集数，并用首片估算速度。
// 实测 14 条线路里有 3 条整体连不上（都指向 mv.gzlcl.com），必须能在几秒内判负。
// 剧集按「抽样」体检：只测第 1 集 + 均匀抽样的几集，整条线路连不上靠这几集就够判负；
// 个别集缺片由下载时的重试兜底。电影只有 1 集，仍是全量体检。

const { resolvePlaylist } = require('./hls')
const { UA } = require('./jianpian')
const { fetchKey } = require('./crypto-hls')

const PROBE_TIMEOUT_MS = 6000
const LINE_PROBE_CONCURRENCY = 4
const EPISODE_PROBE_CONCURRENCY = 5
const SPEED_TEST_SEGMENTS = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const SERIES_SAMPLE_COUNT = 4 // 剧集抽样集数：第 1 集 + 按集数均匀分布的几集（含末集）

// 体检要探哪些集。剧集只抽 SAMPLE 集（必含第 1 集），电影全量。
function episodesToProbe(line) {
  const eps = line.episodes
  if (eps.length <= SERIES_SAMPLE_COUNT) return eps
  const picks = new Set([0])
  for (let k = 1; k < SERIES_SAMPLE_COUNT; k++) {
    picks.add(Math.round((k * (eps.length - 1)) / (SERIES_SAMPLE_COUNT - 1)))
  }
  return [...picks].sort((a, b) => a - b).map(i => eps[i])
}

const cache = new Map()

async function headCheck(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': UA, range: 'bytes=0-0' },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  })
  // 部分 CDN 不支持 Range，200 也算通过。
  if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
  await res.arrayBuffer()
}

async function speedTest(segments, keyUrl) {
  const take = segments.slice(0, SPEED_TEST_SEGMENTS)
  if (keyUrl) await fetchKey(keyUrl) // key 取不到就直接判这条线路不可用
  const started = Date.now()
  let bytes = 0
  await Promise.all(
    take.map(async s => {
      const res = await fetch(s.uri, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      bytes += (await res.arrayBuffer()).byteLength
    })
  )
  const ms = Date.now() - started
  return { bytes, ms, mbps: ms > 0 ? bytes / 1048576 / (ms / 1000) : 0 }
}

async function probeEpisode(ep) {
  try {
    const pl = await resolvePlaylist(ep.url)

    let speed = null
    try {
      speed = await speedTest(pl.segments, pl.keyUrl)
    } catch (e) {
      return { ok: false, error: pl.encrypted ? `AES-128 加密线路，取 key 失败：${e.message}` : `首片下载失败：${e.message}` }
    }

    return {
      ok: true,
      encrypted: !!pl.encrypted,
      segmentCount: pl.segments.length,
      duration: Math.round(pl.duration),
      resolution: pl.variant && pl.variant.width ? `${pl.variant.width}x${pl.variant.height}` : null,
      mbps: speed.mbps
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function probeLine(line) {
  const samples = episodesToProbe(line)
  const perEpisode = await mapWithLimit(samples, EPISODE_PROBE_CONCURRENCY, async ep => {
    const r = await probeEpisode(ep)
    return { sort: ep.sort, ...r }
  })

  const okList = perEpisode.filter(r => r.ok)
  const durations = okList.map(r => r.duration).filter(n => n > 0)
  const speeds = okList.map(r => r.mbps).filter(n => n > 0)

  return {
    index: line.index,
    name: line.name,
    host: line.host,
    alive: okList.length,
    total: samples.length,
    episodeCount: line.episodes.length,
    sampled: samples.length < line.episodes.length,
    usable: okList.length > 0,
    encrypted: okList.some(r => r.encrypted),
    failedEpisodes: perEpisode.filter(r => !r.ok).map(r => ({ sort: r.sort, error: r.error })),
    resolution: okList.find(r => r.resolution)?.resolution || null,
    avgSegmentDuration: okList[0]?.duration ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    mbps: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
    probedAt: Date.now()
  }
}

// 返回 { lines: [probeResult] }，结果按可用性和速度排序。
async function probeLines(lines, { force = false } = {}) {
  const key = lines.map(l => `${l.index}:${l.episodes[0]?.url || ''}`).join('|')
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.probes

  const probes = await mapWithLimit(lines, LINE_PROBE_CONCURRENCY, probeLine)
  probes.sort((a, b) => {
    const aUsable = a.usable ? 0 : 1
    const bUsable = b.usable ? 0 : 1
    if (aUsable !== bUsable) return aUsable - bUsable
    return b.mbps - a.mbps
  })

  cache.set(key, { at: Date.now(), probes })
  return probes
}

module.exports = { probeLines, probeEpisode, headCheck }
