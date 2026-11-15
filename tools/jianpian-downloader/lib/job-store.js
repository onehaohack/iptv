// 任务存储：内存队列 + 磁盘快照，服务重启后能恢复未完成的任务。

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const HISTORY_FILE = 'jobs.json'

class JobStore {
  constructor(settings) {
    this.settings = settings
    this.jobs = new Map()
  }

  async init() {
    const root = this.settings.current.downloadRoot
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, HISTORY_FILE), 'utf8'))
      for (const snap of raw.jobs || []) {
        // 重启后不自动续跑，标记为 paused 让用户自己决定。
        if (snap.status === 'running' || snap.status === 'queued') snap.status = 'paused'
        for (const ep of snap.episodes || []) {
          if (ep.status === 'downloading' || ep.status === 'queued') ep.status = 'paused'
        }
        this.jobs.set(snap.id, snap)
      }
    } catch { /* 首次运行没有历史文件 */ }
  }

  create({ videoId, title, lineIndex, lineName, episodes }) {
    const id = crypto.randomUUID()
    const job = {
      id,
      videoId,
      title,
      lineIndex,
      lineName,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      targetDir: null,
      episodes
    }
    this.jobs.set(id, job)
    return job
  }

  get(id) {
    return this.jobs.get(id) || null
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, this.settings.current.historyLimit)
  }

  active() {
    return this.list().filter(j => j.status === 'running' || j.status === 'queued')
  }

  async persist() {
    const root = this.settings.current.downloadRoot
    const jobs = this.list().map(job => ({
      ...job,
      episodes: (job.episodes || []).map(ep => ({
        ...ep,
        segments: undefined // 分片明细不落盘，只留计数
      }))
    }))
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, HISTORY_FILE), JSON.stringify({ savedAt: Date.now(), jobs }, null, 2), 'utf8')
  }

  remove(id) {
    this.jobs.delete(id)
  }
}

module.exports = { JobStore, HISTORY_FILE }
