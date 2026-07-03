import { EOL, ROOT_DIR } from '../../constants'
import fs from 'fs-extra'
import path from 'node:path'

type Candidate = {
  readonly tvgId: string
  readonly title: string
  readonly url: string
  readonly source: string
}

const SOURCE_FILES = [
  'streams/cn.m3u',
  'streams/cn_cctv.m3u',
  'streams/cn_cgtn.m3u'
] as const

const OFFICIAL_HOST_SUFFIXES = [
  'cgtn.com',
  'cctvplus.com',
  'gztv.com',
  'hebtv.com',
  'qtv.com.cn',
  'sztv.com.cn',
  'jxtvcn.com.cn',
  'jilintv.cn',
  'hrbtv.net',
  'brtvcloud.com',
  'kankanlive.com'
] as const

const CURRENTLY_UNREACHABLE_TVG_IDS = new Set([
  'JiangxiChildrensChannel.cn@SD',
  'JiangxiCityChannel.cn@SD',
  'JiangxiEconomyLifeChannel.cn@SD',
  'JiangxiMovieChannel.cn@SD',
  'JiangxiPublicAgricultureChannel.cn@SD',
  'JilinCityChannel.cn@SD',
  'JilinLifestyleChannel.cn@SD',
  'JilinMovieChannel.cn@SD',
  'JilinRuralChannel.cn@SD',
  'NanchangNewsGeneralistChannel.cn@SD',
  'ShenzhenSatelliteTV.cn@SD'
])

const OUTPUT_FILE = 'tvbox/app/src/main/assets/channels_cn_public.m3u'

async function main(): Promise<void> {
  const candidates = await loadCandidates()
  const playlist = toPlaylist(candidates)
  const outputPath = path.resolve(ROOT_DIR, OUTPUT_FILE)

  await fs.ensureDir(path.dirname(outputPath))
  await fs.writeFile(outputPath, playlist, 'utf8')

  console.log(`saved ${candidates.length} streams to ${OUTPUT_FILE}`)
}

async function loadCandidates(): Promise<readonly Candidate[]> {
  const candidates: Candidate[] = []

  for (const sourceFile of SOURCE_FILES) {
    const filepath = path.resolve(ROOT_DIR, sourceFile)
    const content = await fs.readFile(filepath, 'utf8')
    candidates.push(...parsePlaylist(content, sourceFile))
  }

  return dedupeByChannel(candidates.filter(isOfficialPublicStream))
}

function parsePlaylist(content: string, source: string): readonly Candidate[] {
  const candidates: Candidate[] = []
  let pending: Pick<Candidate, 'tvgId' | 'title'> | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const extinf = line.match(/^#EXTINF:-1\s+tvg-id="([^"]*)",(.*)$/)
    if (extinf) {
      const tvgId = extinf[1] || ''
      const title = extinf[2] || ''
      pending = { tvgId, title }
      continue
    }

    if (!pending || !line.startsWith('http')) continue

    candidates.push({
      tvgId: pending.tvgId,
      title: pending.title,
      url: line,
      source
    })
    pending = null
  }

  return candidates
}

function isOfficialPublicStream(candidate: Candidate): boolean {
  if (CURRENTLY_UNREACHABLE_TVG_IDS.has(candidate.tvgId)) return false
  if (candidate.title.includes('[Geo-blocked]')) return false
  if (candidate.url.includes('_upt=')) return false
  if (candidate.url.includes('auth=')) return false

  let hostname = ''
  try {
    hostname = new URL(candidate.url).hostname
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }

  return OFFICIAL_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

function dedupeByChannel(candidates: readonly Candidate[]): readonly Candidate[] {
  const byChannel = new Map<string, Candidate>()

  for (const candidate of candidates) {
    const key = candidate.tvgId || normalizeTitle(candidate.title)
    const current = byChannel.get(key)
    if (!current || score(candidate) > score(current)) {
      byChannel.set(key, candidate)
    }
  }

  return [...byChannel.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s+\[[^\]]+\]$/g, '')
    .replace(/\s+\([^)]+\)$/g, '')
    .trim()
    .toLowerCase()
}

function score(candidate: Candidate): number {
  let value = 0
  if (candidate.url.startsWith('https://')) value += 10
  if (candidate.title.includes('(1080p)')) value += 5
  if (candidate.title.includes('(720p)')) value += 3
  if (!candidate.title.includes('[Not 24/7]')) value += 2
  if (candidate.source === 'streams/cn.m3u') value += 1

  return value
}

function toPlaylist(candidates: readonly Candidate[]): string {
  const lines = ['#EXTM3U']

  for (const candidate of candidates) {
    lines.push(`#EXTINF:-1 tvg-id="${candidate.tvgId}",${candidate.title}`)
    lines.push(candidate.url)
  }

  return `${lines.join(EOL)}${EOL}`
}

main()
