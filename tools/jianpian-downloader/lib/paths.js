// 目标目录与文件命名：清洗片名、决定单集/剧集命名、避免路径穿越和重名覆盖。

const fs = require('node:fs/promises')
const path = require('node:path')

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]+/g
const MAX_TITLE_CHARS = 80

function sanitizeName(raw, fallback = '未命名') {
  let s = String(raw || '').replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/, '') // Finder 不允许文件名以点或空格结尾
  if (s.length > MAX_TITLE_CHARS) s = s.slice(0, MAX_TITLE_CHARS).trim()
  if (!s || s === '.' || s === '..') return fallback
  return s
}

function padSort(sort) {
  const n = Number(sort)
  return Number.isFinite(n) ? String(n).padStart(2, '0') : '00'
}

// 单集（电影）→ 剧名.mp4；多集 → 剧名 S01E03.mp4
// 用 SxxExx 是为了让飞牛影视（fnOS）/ Emby / Plex 这类媒体库能直接正确刮削，
// 「第03集」这种命名它们也认，但 SxxExx 最稳。目前线路数据里没有季信息，统一 S01。
function episodeFileName(title, sort, isMovie, season = 1) {
  const safe = sanitizeName(title)
  if (isMovie) return `${safe}.mp4`
  const s = String(Number(season) || 1).padStart(2, '0')
  return `${safe} S${s}E${padSort(sort)}.mp4`
}

// root + title → 影片目录，确保不会逃出 root。
async function ensureVideoDir(root, title) {
  const dirName = sanitizeName(title)
  const dir = path.resolve(root, dirName)
  if (dir !== path.resolve(root) && !dir.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`非法目录名：${dirName}`)
  }
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// 已存在同名文件时不覆盖：剧名 第01集 (2).mp4
async function uniquePath(dir, fileName) {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let candidate = path.join(dir, fileName)
  for (let i = 2; i < 100; i++) {
    try {
      await fs.stat(candidate)
    } catch {
      return candidate
    }
    candidate = path.join(dir, `${base} (${i})${ext}`)
  }
  throw new Error(`同名文件过多：${fileName}`)
}

// Node 没有 statvfs，用 /bin/df 读真实挂载点。
// 注意：下载目录可能是软链接（例如 ~/Downloads → /Volumes/ssd/Downloads），
// 必须先 realpath，否则 df 可能报成 / 所在的 APFS 卷，剩余空间就错了。
async function diskFreeBytes(dir) {
  const { execFile } = require('node:child_process')
  const real = await fs.realpath(dir).catch(() => dir)
  const bytes = await new Promise((resolve, reject) => {
    execFile('/bin/df', ['-kP', real], { encoding: 'utf8' }, (err, out) => {
      if (err) return reject(err)
      const line = out.trim().split('\n').pop()
      const cols = line.split(/\s+/)
      // 1024-blocks Used Available Capacity Mounted on → 第 3 列是可用块数
      const avail = Number(cols[2])
      if (!Number.isFinite(avail)) return reject(new Error('df 输出无法解析'))
      resolve(avail * 1024)
    })
  })
  return bytes
}

// 返回 df 的挂载点，方便界面上说明空间统计的是哪个盘。
async function diskMountPoint(dir) {
  const { execFile } = require('node:child_process')
  const real = await fs.realpath(dir).catch(() => dir)
  return new Promise(resolve => {
    execFile('/bin/df', ['-kP', real], { encoding: 'utf8' }, (err, out) => {
      if (err) return resolve(null)
      const line = out.trim().split('\n').pop()
      resolve(line.split(/\s+/).slice(5).join(' ') || null)
    })
  })
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

module.exports = { sanitizeName, episodeFileName, ensureVideoDir, uniquePath, diskFreeBytes, diskMountPoint, formatBytes, padSort }
