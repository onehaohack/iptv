#!/usr/bin/env node
// 荐片下载器本地服务：搜索 → 选线路 → 选集 → 下载到本机目录。
// 用法: node tools/jianpian-downloader/server.js [--port 8790]

const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const os = require('node:os')

const settings = require('./lib/settings')
const jianpian = require('./lib/jianpian')
const { probeLines } = require('./lib/probe')
const { JobStore } = require('./lib/job-store')
const { Scheduler, publicEpisode } = require('./lib/scheduler')
const { diskFreeBytes, diskMountPoint, formatBytes } = require('./lib/paths')

const PUBLIC_DIR = path.join(__dirname, 'public')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
}

const settingsState = { current: null }

async function loadSettings() {
  settingsState.current = await settings.load()
  return settingsState.current
}

const store = new JobStore(settingsState)
const scheduler = new Scheduler(settingsState, store)

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(payload)
}

function fail(res, status, message) {
  send(res, status, { error: message })
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// 只服务 public/ 下的固定文件，不接受任意路径。
async function serveStatic(req, res, urlPath) {
  const map = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }
  const file = map[urlPath]
  if (!file) return fail(res, 404, 'not found')

  try {
    const body = await fs.readFile(path.join(PUBLIC_DIR, file))
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    fail(res, 404, 'not found')
  }
}

async function handleApi(req, res, url) {
  const route = url.pathname
  const q = url.searchParams

  if (route === '/api/search' && req.method === 'GET') {
    const key = (q.get('key') || '').trim()
    if (!key) return fail(res, 400, '缺少搜索词')
    const page = Math.max(1, Number(q.get('page')) || 1)
    try {
      return send(res, 200, await jianpian.search(key, page))
    } catch (e) {
      return fail(res, 502, `搜索失败：${e.message}`)
    }
  }

  if (route === '/api/detail' && req.method === 'GET') {
    const id = Number(q.get('id'))
    if (!Number.isFinite(id)) return fail(res, 400, '缺少影片 id')
    try {
      const d = await jianpian.detail(id)
      // 选集页需要每集的 url，所以这里保留完整 episodes（只去掉冗余字段）
      return send(res, 200, {
        ...d,
        lines: d.lines.map(l => ({
          index: l.index,
          name: l.name,
          host: l.host,
          episodeCount: l.episodeCount,
          duplicateCount: l.duplicateCount,
          episodes: l.episodes.map(e => ({ sort: e.sort, label: e.label, url: e.url }))
        }))
      })
    } catch (e) {
      return fail(res, 502, `详情获取失败：${e.message}`)
    }
  }

  if (route === '/api/probe' && req.method === 'GET') {
    const id = Number(q.get('id'))
    if (!Number.isFinite(id)) return fail(res, 400, '缺少影片 id')
    try {
      const d = await jianpian.detail(id)
      const probes = await probeLines(d.lines, { force: q.get('force') === '1' })
      return send(res, 200, {
        id,
        title: d.title,
        isMovie: d.lines[0] ? d.lines[0].episodeCount <= 1 : false,
        probes
      })
    } catch (e) {
      return fail(res, 502, `线路体检失败：${e.message}`)
    }
  }

  if (route === '/api/jobs' && req.method === 'GET') {
    return send(res, 200, {
      jobs: store.list().map(job => ({
        id: job.id,
        videoId: job.videoId,
        title: job.title,
        status: job.status,
        lineName: job.lineName,
        targetDir: job.targetDir,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
        summary: scheduler.summary(job),
        episodes: (job.episodes || []).map(publicEpisode)
      }))
    })
  }

  if (route === '/api/jobs' && req.method === 'POST') {
    const body = await readJson(req)
    const videoId = Number(body.videoId)
    const lineIndex = Number(body.lineIndex)
    if (!Number.isFinite(videoId) || !Number.isFinite(lineIndex)) return fail(res, 400, '缺少 videoId 或 lineIndex')

    let full
    try {
      full = await jianpian.detail(videoId) // 每次建任务都重取，线路 URL 会随片源更新变化
    } catch (e) {
      return fail(res, 502, `详情获取失败：${e.message}`)
    }

    const line = full.lines.find(l => l.index === lineIndex)
    if (!line) return fail(res, 400, '线路不存在')

    const wanted = Array.isArray(body.episodes) && body.episodes.length
      ? new Set(body.episodes.map(Number))
      : new Set(line.episodes.map(e => e.sort))

    const episodes = line.episodes
      .filter(e => wanted.has(e.sort))
      .map(e => ({
        sort: e.sort,
        label: e.label,
        url: e.url,
        lineName: line.name,
        status: 'queued',
        segmentTotal: 0,
        segmentDone: 0,
        bytesDone: 0,
        mbps: 0
      }))

    if (!episodes.length) return fail(res, 400, '没有选中任何集')

    const job = store.create({
      videoId,
      title: full.title,
      lineIndex,
      lineName: line.name,
      episodes
    })
    job.isMovie = line.episodeCount <= 1

    await store.persist()
    scheduler.start(job.id).catch(e => {
      scheduler.broadcast('job', { jobId: job.id, status: 'failed', error: e.message })
    })

    return send(res, 202, { id: job.id, title: job.title, episodes: episodes.length })
  }

  // 注意：action 取的是带斜杠的整段（第 2 组），去掉开头的 '/' 才是动作名。
  const jobMatch = route.match(/^\/api\/jobs\/([0-9a-f-]+)(?:\/(pause|cancel|retry|events))?$/)
  if (jobMatch) {
    const [, jobId, rawAction] = jobMatch
    const action = rawAction ? rawAction.replace(/^\//, '') : null
    const job = store.get(jobId)
    if (!job) return fail(res, 404, '任务不存在')

    if (action === 'pause') {
      scheduler.pause(jobId)
      return send(res, 200, { id: jobId, status: job.status })
    }
    if (action === 'cancel') {
      scheduler.cancel(jobId)
      return send(res, 200, { id: jobId, status: job.status })
    }
    if (action === 'retry' && req.method === 'POST') {
      const sort = Number(q.get('sort'))
      const ep = scheduler.retryEpisode(jobId, sort)
      if (!ep) return fail(res, 404, '集不存在')
      scheduler.start(jobId).catch(() => {})
      return send(res, 200, { id: jobId, episode: publicEpisode(ep) })
    }
    if (action === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      })
      const sendEvent = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
      sendEvent('job', { jobId, status: job.status, targetDir: job.targetDir, summary: scheduler.summary(job) })
      for (const ep of job.episodes) sendEvent('episode', { jobId, episode: publicEpisode(ep), summary: scheduler.summary(job) })

      const unsubscribe = scheduler.subscribe((type, payload) => {
        if (payload.jobId && payload.jobId !== jobId) return
        sendEvent(type, payload)
      })
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        unsubscribe()
      })
      return
    }
  }

  if (route === '/api/settings' && req.method === 'GET') {
    const root = settingsState.current.downloadRoot
    let free = null
    let mount = null
    try {
      await fs.mkdir(root, { recursive: true })
      free = await diskFreeBytes(root)
      mount = await diskMountPoint(root)
    } catch { /* 目录可能刚被改，读不到就留空 */ }
    return send(res, 200, { ...settingsState.current, freeBytes: free, freeText: formatBytes(free), mountPoint: mount, configPath: settings.CONFIG_FILE })
  }

  if (route === '/api/settings' && req.method === 'PUT') {
    const body = await readJson(req)
    try {
      const next = await settings.save(body)
      settingsState.current = next
      return send(res, 200, next)
    } catch (e) {
      return fail(res, 400, e.message)
    }
  }

  if (route === '/api/pick-folder' && req.method === 'POST') {
    return new Promise(resolve => {
      const script = 'POSIX path of (choose folder with prompt "选择下载目录")'
      const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', d => {
        out += d
      })
      child.stderr.on('data', d => {
        err += d
      })
      child.on('close', async code => {
        const dir = out.trim()
        if (code !== 0 || !dir) return resolve(fail(res, 409, err.trim() || '未选择目录'))
        try {
          const next = await settings.save({ ...settingsState.current, downloadRoot: dir })
          settingsState.current = next
          resolve(send(res, 200, next))
        } catch (e) {
          resolve(fail(res, 400, e.message))
        }
      })
    })
  }

  if (route === '/api/reveal' && req.method === 'POST') {
    const body = await readJson(req)
    const jobId = String(body.jobId || '')
    const job = store.get(jobId)
    const dir = job ? job.targetDir : settingsState.current.downloadRoot
    if (!dir) return fail(res, 400, '目录尚未创建')
    spawn('open', [dir], { stdio: 'ignore' })
    return send(res, 200, { opened: dir })
  }

  return fail(res, 404, 'not found')
}

async function main() {
  await loadSettings()
  await store.init()

  const argPort = Number((process.argv.find(a => a.startsWith('--port=')) || '').split('=')[1])
  const port = Number.isFinite(argPort) && argPort ? argPort : settingsState.current.port

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
      return await serveStatic(req, res, url.pathname)
    } catch (e) {
      if (!res.headersSent) fail(res, 500, e.message || 'server error')
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`荐片下载器 http://127.0.0.1:${port}`)
    console.log(`下载目录 ${settingsState.current.downloadRoot}`)
    console.log(`配置文件 ${settings.CONFIG_FILE}`)
  })

  const shutdown = () => {
    for (const job of store.active()) scheduler.pause(job.id)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(e => {
  console.error('启动失败:', e.message)
  process.exit(1)
})
