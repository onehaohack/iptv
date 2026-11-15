// 下载引擎：分片并发下载 → 顺序拼接 .ts → 直通转封装 mp4（顺带剪广告）。
// 每集独立，单集失败不影响其他集；支持暂停/取消/续传。

const fs = require('node:fs/promises')
const path = require('node:path')

const { resolvePlaylist } = require('./hls')
const { UA } = require('./jianpian')
const { fetchKey, SegmentCipher, looksLikeTs } = require('./crypto-hls')
const { ensureVideoDir, uniquePath, episodeFileName } = require('./paths')
const { remuxToMp4 } = require('./remux')

const SEGMENT_RETRIES = 3
const RETRY_BASE_MS = 1000
const SEGMENT_TIMEOUT_MS = 30000

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fileSize(p) {
  try {
    return (await fs.stat(p)).size
  } catch {
    return -1
  }
}

async function downloadSegment(url, target, cipher) {
  let lastError = null
  for (let attempt = 0; attempt <= SEGMENT_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      let buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength === 0) throw new Error('分片为空')

      if (cipher) {
        // 序号用播放列表里的原始下标：AES-128 的默认 IV 依赖分片序号。
        buf = cipher.decrypt(buf, cipher.sequenceFor(url))
        if (!looksLikeTs(buf)) throw new Error('解密结果不是有效的 TS 数据')
      }

      await fs.writeFile(target, buf)
      return buf.byteLength
    } catch (e) {
      lastError = e
      if (attempt < SEGMENT_RETRIES) await sleep(RETRY_BASE_MS * 2 ** attempt)
    }
  }
  throw lastError
}

// 顺序拼接：分片按播放列表顺序写入同一个 .part.ts，避免整集驻留内存。
async function assembleTs(partsDir, count, outPath) {
  const handle = await fs.open(outPath, 'w')
  try {
    for (let i = 0; i < count; i++) {
      const name = String(i).padStart(6, '0') + '.ts'
      const buf = await fs.readFile(path.join(partsDir, name))
      await handle.write(buf)
    }
  } finally {
    await handle.close()
  }
  return fileSize(outPath)
}

class Downloader {
  constructor(settings) {
    this.settings = settings
  }

  // 单集：playlist → 分片 → ts → mp4
  async downloadEpisode(job, epState, onProgress, control = { paused: false, cancelled: false }) {
    const cfg = this.settings.current
    const videoDir = job.targetDir
    const partsDir = path.join(videoDir, '.parts', String(epState.sort))
    const tsPath = path.join(videoDir, `.ep${String(epState.sort).padStart(2, '0')}.part.ts`)
    const mp4Part = path.join(videoDir, `.ep${String(epState.sort).padStart(2, '0')}.part.mp4`)

    epState.status = 'downloading'
    epState.error = null
    epState.startedAt = Date.now()

    let playlist
    try {
      playlist = await resolvePlaylist(epState.url)
    } catch (e) {
      epState.status = 'failed'
      epState.error = `播放列表获取失败：${e.message}`
      onProgress(job, epState)
      return false
    }

    if (playlist.encrypted && !playlist.keyUrl) {
      epState.status = 'failed'
      epState.error = '该线路分片加密方式不支持（需要 key，播放列表未给出）'
      onProgress(job, epState)
      return false
    }

    let cipher = null
    if (playlist.keyUrl) {
      try {
        const key = await fetchKey(playlist.keyUrl)
        const seqFor = new Map(playlist.segments.map((s, i) => [s.uri, i]))
        cipher = new SegmentCipher(key.buffer, playlist.explicitIv)
        cipher.sequenceFor = uri => seqFor.get(uri) ?? 0
        epState.encrypted = true
      } catch (e) {
        epState.status = 'failed'
        epState.error = `AES-128 key 获取失败：${e.message}`
        onProgress(job, epState)
        return false
      }
    }

    await fs.mkdir(partsDir, { recursive: true })

    // CDN 两次返回的播放列表长度可能不一致（实测同一集 1643 / 1647），
    // 所以分片总数以本次解析为准，续传时按已有文件重新统计。
    epState.segmentTotal = playlist.segments.length
    epState.segmentDone = 0
    epState.bytesDone = 0
    epState.durationSec = Math.round(playlist.duration)
    onProgress(job, epState)

    const queue = playlist.segments.map((s, i) => ({ s, i }))
    let cursor = 0
    let failed = null
    const started = Date.now()

    const stopped = () => control.cancelled || control.paused

    const worker = async () => {
      while (cursor < queue.length) {
        if (stopped()) return
        const { s, i } = queue[cursor++]
        const name = String(i).padStart(6, '0') + '.ts'
        const target = path.join(partsDir, name)

        const existing = await fileSize(target)
        if (existing > 0) {
          epState.bytesDone += existing
        } else {
          try {
            epState.bytesDone += await downloadSegment(s.uri, target, cipher)
          } catch (e) {
            failed = failed || new Error(`分片 ${i} 失败：${e.message}`)
            continue
          }
        }

        epState.segmentDone++
        const elapsed = (Date.now() - started) / 1000
        epState.mbps = elapsed > 0 ? epState.bytesDone / 1048576 / elapsed : 0
        onProgress(job, epState)
      }
    }

    await Promise.all(Array.from({ length: Math.min(cfg.segmentConcurrency, queue.length) }, worker))

    if (stopped()) {
      epState.status = control.cancelled ? 'cancelled' : 'paused'
      onProgress(job, epState)
      return false
    }

    if (failed || epState.segmentDone !== epState.segmentTotal) {
      epState.status = 'failed'
      epState.error = failed ? failed.message : `分片不完整：${epState.segmentDone}/${epState.segmentTotal}`
      onProgress(job, epState)
      return false
    }

    epState.status = 'assembling'
    onProgress(job, epState)

    const tsBytes = await assembleTs(partsDir, epState.segmentTotal, tsPath)
    await fs.rm(partsDir, { recursive: true, force: true })

    if (tsBytes <= 0) {
      epState.status = 'failed'
      epState.error = '拼接后文件为空'
      onProgress(job, epState)
      return false
    }

    let finalPath
    if (cfg.remuxToMp4) {
      epState.status = 'remuxing'
      onProgress(job, epState)

      const conv = await remuxToMp4(tsPath, mp4Part)

      if (conv.ok) {
        await fs.rm(tsPath, { force: true })
        finalPath = await uniquePath(videoDir, episodeFileName(job.title, epState.sort, job.isMovie))
        await fs.rename(mp4Part, finalPath)
        epState.bytesDone = conv.bytes
        epState.outputFile = path.basename(finalPath)
        // 流里夹的广告段已被剪掉，界面上说明一下
        if (conv.cutSec >= 1) epState.cutSec = Math.round(conv.cutSec)
      } else {
        // 转封装失败：保留 .ts，不让整集白下。
        await fs.rm(mp4Part, { force: true })
        finalPath = await uniquePath(videoDir, episodeFileName(job.title, epState.sort, job.isMovie).replace(/\.mp4$/, '.ts'))
        await fs.rename(tsPath, finalPath)
        epState.outputFile = path.basename(finalPath)
        epState.warning = `转封装失败，已保留 TS：${conv.error}`
      }
    } else {
      finalPath = await uniquePath(videoDir, episodeFileName(job.title, epState.sort, job.isMovie).replace(/\.mp4$/, '.ts'))
      await fs.rename(tsPath, finalPath)
      epState.outputFile = path.basename(finalPath)
    }

    epState.status = 'done'
    epState.finishedAt = Date.now()
    onProgress(job, epState)
    return true
  }

  async prepareJobDir(job) {
    job.targetDir = await ensureVideoDir(this.settings.current.downloadRoot, job.title)
    return job.targetDir
  }
}

module.exports = { Downloader }
