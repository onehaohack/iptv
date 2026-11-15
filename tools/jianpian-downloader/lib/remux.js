// MP4 转封装：调用自带的 Swift 小工具做「直通 + 剪广告」。
//
// 为什么不用 avconvert：
//   这些线路的流里会夹广告，广告段是 1920x1080，正片是 1920x960。
//   同一条 TS 里分辨率中途变了，MP4 一条轨道只能有一个 SPS，
//   AVAssetExportSession（avconvert 的底层）会直接报 -11800 / -16364。
//
// 这里的 native/remux.swift 做三件事：
//   1. 按分辨率统计，多数派是正片，少数派当广告；
//   2. 把广告段（延伸到下一个关键帧）从时间轴上剪掉；
//   3. 其余采样直通写入 MP4，不重编码，画质零损失。
// 工具首次使用时用 swiftc 编译到 build/ 下，之后复用。

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const SWIFT_SRC = path.join(__dirname, '..', 'native', 'remux.swift')
const BUILD_DIR = path.join(__dirname, '..', 'build')
const BINARY = path.join(BUILD_DIR, 'remux')
const AVCONVERT = process.env.JIANPIAN_AVCONVERT || '/usr/bin/avconvert'
const SWIFTC = process.env.JIANPIAN_SWIFTC || '/usr/bin/swiftc'
// Linux 上没有 avconvert，也没有 swiftc：转封装交给外部命令（一般是 ffmpeg）。
// 设了 JIANPIAN_REMUX_CMD 就完全接管，值里用 {input} {output} 占位，例如：
//   JIANPIAN_REMUX_CMD='ffmpeg -y -fflags +genpts -i {input} -c copy -map 0 {output}'
const EXTERNAL_REMUX = process.env.JIANPIAN_REMUX_CMD || null
const REMUX_TIMEOUT_MS = 20 * 60 * 1000
const COMPILE_TIMEOUT_MS = 5 * 60 * 1000

let ensurePromise = null

async function fileMtime(p) {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

// 编译一次就够了；并发下载时用同一个 promise，避免两个 worker 同时调 swiftc。
function ensureBinary() {
  // 非 macOS（比如远程 Linux 机器）没有 swiftc，直接走外部命令。
  if (EXTERNAL_REMUX) return Promise.resolve(null)
  if (!fsSync.existsSync(SWIFTC)) return Promise.resolve(null)
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    const srcTime = await fileMtime(SWIFT_SRC)
    const binTime = await fileMtime(BINARY)
    if (binTime && binTime >= srcTime) return BINARY

    await fs.mkdir(BUILD_DIR, { recursive: true })
    const res = spawnSync(SWIFTC, ['-O', '-o', BINARY, SWIFT_SRC], {
      encoding: 'utf8',
      timeout: COMPILE_TIMEOUT_MS
    })
    if (res.status !== 0) {
      ensurePromise = null // 允许下次重试
      throw new Error(`编译 remux 失败：${(res.stderr || '').trim().slice(0, 300) || res.error?.message || res.status}`)
    }
    return BINARY
  })()
  return ensurePromise
}

function run(bin, args) {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), REMUX_TIMEOUT_MS)
    child.stdout.on('data', d => {
      out += d.toString()
    })
    child.stderr.on('data', d => {
      err += d.toString()
    })
    child.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, error: e.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, exitCode: code, stdout: out.trim(), stderr: err.trim() })
    })
  })
}

async function fileSize(p) {
  try {
    return (await fs.stat(p)).size
  } catch {
    return -1
  }
}

function avconvertFallback(source, output) {
  return run(AVCONVERT, ['--preset', 'PresetPassthrough', '--source', source, '--output', output, '--replace'])
}

// Linux 上的等价做法：外部命令直通拷贝。{input}/{output} 占位替换。
function externalRemux(source, output) {
  const cmd = EXTERNAL_REMUX.replace(/\{input\}/g, JSON.stringify(source)).replace(/\{output\}/g, JSON.stringify(output))
  return run('/bin/sh', ['-c', cmd])
}

// 返回 { ok, bytes, cutSec, engine, error }
async function remuxToMp4(source, output) {
  if (EXTERNAL_REMUX) {
    const res = await externalRemux(source, output)
    const bytes = await fileSize(output)
    if (res.ok && bytes > 0) return { ok: true, bytes, cutSec: 0, engine: 'external' }
    return { ok: false, engine: 'external', error: res.stderr || res.error || '外部转封装失败' }
  }

  let binary = null
  let compileError = null
  try {
    binary = await ensureBinary()
  } catch (e) {
    compileError = e.message
  }

  if (binary) {
    const res = await run(binary, [source, output])
    if (res.ok) {
      const m = /OK (\d+)(?: dropped=([\d.]+))?/.exec(res.stdout || '')
      const bytes = m ? Number(m[1]) : await fileSize(output)
      const cutSec = m && m[2] ? Number(m[2]) : 0
      if (bytes > 0) return { ok: true, bytes, cutSec, engine: 'remux' }
      return { ok: false, error: '转封装没有产生有效文件', engine: 'remux' }
    }
    // 自带工具失败时再退一步试 avconvert（老路径，遇到混分辨率仍然会失败）
    const fallback = await avconvertFallback(source, output)
    const fallbackBytes = await fileSize(output)
    if (fallback.ok && fallbackBytes > 0) {
      return { ok: true, bytes: fallbackBytes, cutSec: 0, engine: 'avconvert' }
    }
    return {
      ok: false,
      engine: 'remux',
      error: `${res.stderr || res.error || '转封装失败'}${compileError ? `（编译信息：${compileError}）` : ''}`
    }
  }

  const fallback = await avconvertFallback(source, output)
  const fallbackBytes = await fileSize(output)
  if (fallback.ok && fallbackBytes > 0) {
    return { ok: true, bytes: fallbackBytes, cutSec: 0, engine: 'avconvert' }
  }
  return {
    ok: false,
    engine: 'avconvert',
    error: `${compileError || 'swiftc 不可用'}；avconvert 也失败：${fallback.stderr || fallback.error || '未知错误'}`
  }
}

module.exports = { remuxToMp4, ensureBinary, BINARY, SWIFT_SRC }
