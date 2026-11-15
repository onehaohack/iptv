// 下载器配置：读写、校验、默认值。
// 配置文件放在用户目录，不进仓库。

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JianpianDownloader')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS = {
  downloadRoot: path.join(os.homedir(), 'Downloads', '荐片'),
  episodeConcurrency: 2,
  segmentConcurrency: 6,
  port: 8790,
  autoFallback: true,
  remuxToMp4: true,
  historyLimit: 50
}

const LIMITS = {
  episodeConcurrency: [1, 4],
  segmentConcurrency: [1, 12],
  port: [1024, 65535],
  historyLimit: [1, 200]
}

function clampInt(value, [min, max], fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// 保存目录必须是绝对路径、存在、可写。返回解析后的真实路径。
async function validateRoot(dir) {
  const raw = String(dir || '').trim()
  if (!raw) throw new Error('下载目录不能为空')

  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
  if (!path.isAbsolute(expanded)) throw new Error('下载目录必须是绝对路径')

  let stat
  try {
    stat = await fs.stat(expanded)
  } catch {
    throw new Error(`下载目录不存在：${expanded}`)
  }
  if (!stat.isDirectory()) throw new Error(`不是目录：${expanded}`)

  try {
    await fs.access(expanded, fs.constants.W_OK)
  } catch {
    throw new Error(`目录不可写：${expanded}`)
  }

  return path.resolve(expanded)
}

function normalize(raw) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    downloadRoot: String(cfg.downloadRoot || DEFAULTS.downloadRoot),
    episodeConcurrency: clampInt(cfg.episodeConcurrency, LIMITS.episodeConcurrency, DEFAULTS.episodeConcurrency),
    segmentConcurrency: clampInt(cfg.segmentConcurrency, LIMITS.segmentConcurrency, DEFAULTS.segmentConcurrency),
    port: clampInt(cfg.port, LIMITS.port, DEFAULTS.port),
    autoFallback: cfg.autoFallback !== false,
    remuxToMp4: cfg.remuxToMp4 !== false,
    historyLimit: clampInt(cfg.historyLimit, LIMITS.historyLimit, DEFAULTS.historyLimit)
  }
}

async function load() {
  try {
    return normalize(JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')))
  } catch {
    return normalize({})
  }
}

// 只写入允许修改的字段，其余保持默认。
async function save(patch) {
  const current = await load()
  const next = normalize({ ...current, ...patch })
  const realRoot = await validateRoot(next.downloadRoot)
  next.downloadRoot = realRoot

  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}

module.exports = { load, save, normalize, validateRoot, DEFAULTS, CONFIG_FILE, CONFIG_DIR }
