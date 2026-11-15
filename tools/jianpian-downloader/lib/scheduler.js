// 任务调度：集级并发 + 分片级并发，状态机、暂停/恢复/取消、SSE 事件广播。

const { Downloader } = require('./downloader')

const EPISODE_STATUSES = ['queued', 'downloading', 'assembling', 'remuxing', 'done', 'failed', 'paused', 'cancelled']

class Scheduler {
  constructor(settings, store) {
    this.settings = settings
    this.store = store
    this.downloader = new Downloader(settings)
    this.listeners = new Set()
    this.running = new Map() // jobId → { workers: Promise[], controller }
    this.dirty = false
    this.flushTimer = null
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  broadcast(type, payload) {
    for (const fn of this.listeners) {
      try {
        fn(type, payload)
      } catch { /* 客户端断开，忽略 */ }
    }
  }

  summary(job) {
    const eps = job.episodes || []
    const done = eps.filter(e => e.status === 'done').length
    const failed = eps.filter(e => e.status === 'failed').length
    const bytesDone = eps.reduce((a, e) => a + (e.bytesDone || 0), 0)
    const segmentDone = eps.reduce((a, e) => a + (e.segmentDone || 0), 0)
    const segmentTotal = eps.reduce((a, e) => a + (e.segmentTotal || 0), 0)
    return {
      doneEpisodes: done,
      failedEpisodes: failed,
      totalEpisodes: eps.length,
      bytesDone,
      segmentDone,
      segmentTotal,
      percent: segmentTotal > 0 ? Math.round((segmentDone / segmentTotal) * 100) : 0
    }
  }

  onProgress = (job, ep) => {
    this.recomputeJob(job)
    this.broadcast('episode', {
      jobId: job.id,
      episode: publicEpisode(ep),
      summary: this.summary(job)
    })
    this.scheduleFlush()
  }

  recomputeJob(job) {
    const statuses = new Set(job.episodes.map(e => e.status))
    if (statuses.has('downloading') || statuses.has('assembling') || statuses.has('remuxing')) job.status = 'running'
    else if (statuses.has('queued')) job.status = job.startedAt ? 'running' : 'queued'
    else if (statuses.has('paused')) job.status = 'paused'
    else if (statuses.has('cancelled')) job.status = 'cancelled'
    else if (job.episodes.every(e => e.status === 'done')) job.status = 'done'
    else if (job.episodes.every(e => e.status === 'failed')) job.status = 'failed'
    else job.status = 'partial'

    if (job.status === 'done' || job.status === 'failed' || job.status === 'partial') {
      if (!job.finishedAt) job.finishedAt = Date.now()
    }
  }

  scheduleFlush() {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      if (!this.dirty) return
      this.dirty = false
      try {
        await this.store.persist()
      } catch { /* 写历史失败不影响下载 */ }
    }, 1500)
  }

  async start(jobId) {
    if (this.running.has(jobId)) return this.store.get(jobId)

    const job = this.store.get(jobId)
    if (!job) throw new Error('任务不存在')

    await this.downloader.prepareJobDir(job)
    job.startedAt = job.startedAt || Date.now()
    job.status = 'running'

    for (const ep of job.episodes) {
      if (ep.status === 'cancelled') continue
      if (ep.status !== 'done') ep.status = 'queued'
    }

    this.broadcast('job', { jobId: job.id, status: job.status, targetDir: job.targetDir, summary: this.summary(job) })

    const limit = this.settings.current.episodeConcurrency
    let cursor = 0
    const stop = { cancelled: false }
    const control = { paused: false, cancelled: false }
    this.running.set(jobId, { stop })

    const worker = async () => {
      while (cursor < job.episodes.length && !stop.cancelled) {
        const ep = job.episodes[cursor++]
        if (ep.status === 'done' || ep.status === 'cancelled') continue
        if (job.status === 'paused') return

        const ok = await this.downloader.downloadEpisode(job, ep, this.onProgress, control)

        if (!ok && this.settings.current.autoFallback && ep.status === 'failed' && !ep.fellBack) {
          const fallback = await this.findFallback(job, ep)
          if (fallback) {
            ep.fellBack = true
            ep.fallbackFrom = ep.lineName || job.lineName
            ep.url = fallback.url
            ep.lineName = fallback.lineName
            ep.status = 'queued'
            this.broadcast('episode', { jobId: job.id, episode: publicEpisode(ep), summary: this.summary(job) })
            cursor-- // 重试同一集
            continue
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, job.episodes.length) }, worker)
    await Promise.all(workers).catch(() => { /* 单集异常已在状态里体现 */ })

    this.running.delete(jobId)
    this.recomputeJob(job)
    this.broadcast('job', { jobId: job.id, status: job.status, summary: this.summary(job) })
    await this.store.persist()
    return job
  }

  async findFallback(job, failedEp) {
    try {
      const { detail } = require('./jianpian')
      const full = await detail(job.videoId)
      for (const line of full.lines) {
        if (line.index === job.lineIndex) continue
        const match = line.episodes.find(e => e.sort === failedEp.sort)
        if (!match) continue
        return { url: match.url, lineName: line.name }
      }
    } catch { /* 取详情失败则不回退 */ }
    return null
  }

  pause(jobId) {
    const job = this.store.get(jobId)
    if (!job) return null
    for (const ep of job.episodes) {
      if (ep.status === 'downloading' || ep.status === 'assembling' || ep.status === 'remuxing') ep.status = 'paused'
    }
    const tracker = this.running.get(jobId)
    if (tracker) tracker.stop.paused = true
    job.status = 'paused'
    this.broadcast('job', { jobId, status: job.status, summary: this.summary(job) })
    this.store.persist()
    return job
  }

  cancel(jobId) {
    const job = this.store.get(jobId)
    if (!job) return null
    for (const ep of job.episodes) {
      if (ep.status !== 'done') ep.status = 'cancelled'
    }
    const tracker = this.running.get(jobId)
    if (tracker) tracker.stop.cancelled = true
    job.status = 'cancelled'
    job.finishedAt = Date.now()
    this.broadcast('job', { jobId, status: job.status, summary: this.summary(job) })
    this.store.persist()
    return job
  }

  retryEpisode(jobId, sort) {
    const job = this.store.get(jobId)
    if (!job) return null
    const ep = job.episodes.find(e => e.sort === Number(sort))
    if (!ep) return null
    ep.status = 'queued'
    ep.error = null
    ep.fellBack = false
    ep.segmentDone = 0
    ep.bytesDone = 0
    job.finishedAt = null
    this.broadcast('episode', { jobId, episode: publicEpisode(ep), summary: this.summary(job) })
    return ep
  }
}

function publicEpisode(ep) {
  return {
    sort: ep.sort,
    label: ep.label,
    status: ep.status,
    segmentTotal: ep.segmentTotal || 0,
    segmentDone: ep.segmentDone || 0,
    bytesDone: ep.bytesDone || 0,
    mbps: ep.mbps ? Number(ep.mbps.toFixed(2)) : 0,
    durationSec: ep.durationSec || null,
    outputFile: ep.outputFile || null,
    error: ep.error || null,
    warning: ep.warning || null,
    cutSec: ep.cutSec || 0,
    lineName: ep.lineName || null,
    fallbackFrom: ep.fallbackFrom || null,
    percent: ep.segmentTotal ? Math.round((ep.segmentDone / ep.segmentTotal) * 100) : 0
  }
}

module.exports = { Scheduler, publicEpisode, EPISODE_STATUSES }
