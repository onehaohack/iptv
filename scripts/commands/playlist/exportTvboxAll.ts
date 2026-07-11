import { EOL, ROOT_DIR } from '../../constants'
import fs from 'fs-extra'
import path from 'node:path'

type Channel = {
  readonly groupTitle: string
  readonly source: string
  readonly title: string
  readonly tvgId: string
  readonly url: string
}

type PendingChannel = {
  readonly groupTitle: string
  readonly title: string
  readonly tvgId: string
}

const STREAMS_DIR = 'streams'
const OUTPUT_FILE = 'tvbox/app/src/main/assets/channels_all.m3u'
const NON_ENGLISH_NEWS_TITLES = [
  'BBC Alba',
  'BBC Arabic',
  'BBC Drama Italy',
  'BBC Persian',
  'BBC News Pashto',
  'BBC Top Gear Finland',
  'BBC Top Gear France',
  'BBC Top Gear Germany',
  'BBC Top Gear Italy',
  'CNN Noticias',
  'CNN Prima News'
] as const
const EXCLUDED_DOMESTIC_TITLES = ['支持作者'] as const
const VBSKYCN_SOURCE = 'cn_vbskycn.m3u'
const VBSKYCN_CATEGORY = '新加国内源'

async function main(): Promise<void> {
  const channels = await loadChannels()
  const outputPath = path.resolve(ROOT_DIR, OUTPUT_FILE)

  await fs.ensureDir(path.dirname(outputPath))
  await fs.writeFile(outputPath, toPlaylist(channels), 'utf8')

  console.log(`saved ${channels.length} streams to ${OUTPUT_FILE}`)
}

async function loadChannels(): Promise<readonly Channel[]> {
  const streamsDir = path.resolve(ROOT_DIR, STREAMS_DIR)
  const filenames = await fs.readdir(streamsDir)
  const playlistFiles = filenames
    .filter(filename => filename.endsWith('.m3u'))
    .sort((a, b) => a.localeCompare(b))

  const channels: Channel[] = []
  for (const filename of playlistFiles) {
    const content = await fs.readFile(path.join(streamsDir, filename), 'utf8')
    channels.push(...parsePlaylist(content, filename))
  }

  return channels.filter(isTvboxChannel).sort(compareChannels)
}

function parsePlaylist(content: string, source: string): readonly Channel[] {
  const channels: Channel[] = []
  let pending: PendingChannel | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF', 0)) {
      pending = {
        groupTitle: groupTitleForSource(source, extinfAttribute(line, 'group-title')),
        tvgId: extinfAttribute(line, 'tvg-id'),
        title: titleFromExtinf(line)
      }
      continue
    }

    if (!pending || !line.startsWith('http')) continue

    channels.push({
      groupTitle: pending.groupTitle,
      source,
      title: pending.title.trim() || line,
      tvgId: pending.tvgId,
      url: line
    })
    pending = null
  }

  return channels
}

function isTvboxChannel(channel: Channel): boolean {
  return isChinaChannel(channel) || isEnglishBbcOrCnn(channel)
}

function isChinaChannel(channel: Channel): boolean {
  if (EXCLUDED_DOMESTIC_TITLES.some(title => channel.title.startsWith(title))) return false

  return channel.source.startsWith('cn') || channel.tvgId.includes('.cn@')
}

function isEnglishBbcOrCnn(channel: Channel): boolean {
  const title = channel.title.toLowerCase()
  const tvgId = channel.tvgId.toLowerCase()
  const isBbcOrCnn =
    title.startsWith('bbc ') ||
    title.startsWith('cnn') ||
    tvgId.startsWith('bbc') ||
    tvgId.startsWith('cnn')

  if (!isBbcOrCnn) return false
  if (channel.title.includes('(HEVC)')) return false
  if (channel.title.includes('[Geo-blocked]')) return false

  return !NON_ENGLISH_NEWS_TITLES.some(nonEnglishTitle =>
    channel.title.startsWith(nonEnglishTitle)
  )
}

function toPlaylist(channels: readonly Channel[]): string {
  const lines = ['#EXTM3U']

  for (const channel of channels) {
    const groupTitle = channel.groupTitle ? ` group-title="${channel.groupTitle}"` : ''
    lines.push(`#EXTINF:-1 tvg-id="${channel.tvgId}"${groupTitle},${channel.title}`)
    lines.push(channel.url)
  }

  return `${lines.join(EOL)}${EOL}`
}

function compareChannels(left: Channel, right: Channel): number {
  const resolutionPriority = scoreResolution(right.title) - scoreResolution(left.title)
  if (resolutionPriority !== 0) return resolutionPriority

  return left.title.localeCompare(right.title, 'en')
}

function scoreResolution(title: string): number {
  if (title.includes('(1080p)')) return 4
  if (title.includes('(720p)')) return 3
  if (title.includes('(2160p)')) return 2
  if (title.includes('(480p)')) return 1

  return 0
}

function extinfAttribute(line: string, name: string): string {
  const attribute = line.match(new RegExp(`${name}="([^"]*)"`))
  return attribute?.[1] || ''
}

function titleFromExtinf(line: string): string {
  const commaIndex = line.indexOf(',')
  if (commaIndex === -1) return 'Untitled'

  return line.slice(commaIndex + 1)
}

function groupTitleForSource(source: string, groupTitle: string): string {
  if (source === VBSKYCN_SOURCE) return VBSKYCN_CATEGORY

  return groupTitle
}

main()
