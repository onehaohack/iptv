// HLS AES-128 分片解密：Node 内置 crypto 即可，无需第三方依赖。
// 实测荐片里带 EXT-X-KEY 的线路用的是 METHOD=AES-128 + IV=0x…，key 是 .key 文件。

const crypto = require('node:crypto')

const { UA } = require('./jianpian')

const KEY_CACHE_TTL_MS = 30 * 60 * 1000
const keyCache = new Map() // url → { at, iv, buffer }

async function fetchKey(url) {
  const hit = keyCache.get(url)
  if (hit && Date.now() - hit.at < KEY_CACHE_TTL_MS) return hit

  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`取 key 失败 HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength !== 16) throw new Error(`key 长度异常：${buffer.byteLength} 字节（应为 16）`)

  const entry = { at: Date.now(), buffer }
  keyCache.set(url, entry)
  return entry
}

// IV 规则（HLS 规范）：显式 IV 优先，否则用分片序号作为 16 字节大端 IV。
function ivForSequence(explicitIv, sequence) {
  if (explicitIv) {
    const hex = String(explicitIv).replace(/^0x/i, '')
    if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, 'hex')
  }
  const iv = Buffer.alloc(16)
  iv.writeUInt32BE(sequence >>> 0, 12)
  return iv
}

class SegmentCipher {
  constructor(keyBuffer, explicitIv) {
    this.key = keyBuffer
    this.explicitIv = explicitIv || null
  }

  decrypt(buffer, sequence) {
    const iv = ivForSequence(this.explicitIv, sequence)
    const dec = crypto.createDecipheriv('aes-128-cbc', this.key, iv)
    dec.setAutoPadding(true)
    return Buffer.concat([dec.update(buffer), dec.final()])
  }
}

// 校验解密结果：TS 包必须以同步字节 0x47 开头，每 188 字节一个包。
function looksLikeTs(buffer) {
  if (buffer.byteLength < 188) return false
  if (buffer[0] !== 0x47) return false
  if (buffer.byteLength % 188 !== 0) return false
  return buffer[188] === undefined || buffer[188] === 0x47
}

module.exports = { fetchKey, SegmentCipher, ivForSequence, looksLikeTs }
