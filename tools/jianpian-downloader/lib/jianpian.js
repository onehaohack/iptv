// 荐片接口适配层：搜索、详情、线路归一化。
// 只依赖 Node 内置 fetch，UA 不能含中文（HTTP header 只允许 latin1）。

const IMAGE_BASE = 'https://img.cqkgy.com'

const API_HOSTS = ['japi.zxfmj.com', 'sl6eqz.zxfmj.com']

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Jianpian/5.0.4'

// 搜索响应里混着分类节点（电影/剧情/国产…），它们的 id 很小且不是影片。
const CATEGORY_NAMES = new Set([
  '电视剧', '电影', '综艺', '动漫', '纪录片', '短剧', '国产', '港台', '日韩', '欧美',
  '其他', '全部', '动作', '喜剧', '剧情', '爱情', '科幻', '恐怖', '悬疑', '犯罪',
  '战争', '动画', '家庭', '历史', '惊悚', '冒险', '音乐', '运动', '真人秀', '奇幻'
])

function pick(o, keys) {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]
  return null
}

function names(list) {
  if (!Array.isArray(list)) return []
  return list
    .map(x => (typeof x === 'string' ? x : x && (x.name || x.title)))
    .filter(x => typeof x === 'string' && x)
}

// 接口返回的相对路径统一补成可显示的绝对地址。
function imageUrl(p) {
  if (!p || typeof p !== 'string') return null
  if (/^https?:/.test(p)) return p
  return IMAGE_BASE + (p.startsWith('/') ? p : `/${p}`)
}

async function apiGet(pathname, params) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  let lastError = null

  for (const host of API_HOSTS) {
    const url = `https://${host}/api${pathname}${query}`
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${host}`)
        continue
      }
      const body = await res.json()
      // 实测：成功时 code=1（msg 为「搜索成功」「请求成功」），失败时 data 为空。
      if (!body || (body.data == null && !Array.isArray(body.data))) {
        lastError = new Error(`接口没有返回数据 code=${body && body.code} msg=${(body && body.msg) || ''}`)
        continue
      }
      return { body, host }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError || new Error(`请求失败：${pathname}`)
}

function normalizeSearchItem(it) {
  const id = pick(it, ['id', 'video_id'])
  const title = pick(it, ['title', 'name'])
  if (id == null || !title) return null
  if (CATEGORY_NAMES.has(title)) return null
  return {
    id: Number(id),
    title,
    originalName: pick(it, ['original_name']) || null,
    years: names(it.years).slice(0, 2),
    score: Number(it.score) || 0,
    types: names(it.types).slice(0, 4),
    areas: Array.isArray(it.areas) ? it.areas.slice(0, 2) : typeof it.areas === 'string' ? [it.areas] : [],
    actors: names(it.actors).slice(0, 3),
    directors: names(it.directors).slice(0, 2),
    thumbnail: imageUrl(pick(it, ['thumbnail', 'tvimg'])),
    description: String(it.description || '').replace(/\s+/g, ' ').slice(0, 160)
  }
}

async function search(key, page = 1) {
  const { body } = await apiGet('/v2/search/videoV2', { key, page })
  const items = Array.isArray(body.data) ? body.data : []
  const results = items.map(normalizeSearchItem).filter(Boolean)
  return {
    page: Number(page),
    total: Number(body.total) || results.length,
    pageSize: items.length,
    results
  }
}

// 线路去重：多条线路可能给出完全相同的 URL 集合（VIP线路 == 高清线路2）。
// 集数按 sort 去重，保留先出现的；重复的集号记录下来供 UI 提示。
function normalizeLine(line, index) {
  const episodes = []
  const seenSort = new Map()
  let duplicateCount = 0

  for (const ep of line.source_list || []) {
    const url = ep.url
    if (!url || !/^https?:/.test(url)) continue

    const sortRaw = ep.sort != null ? Number(ep.sort) : null
    const sort = Number.isFinite(sortRaw) && sortRaw > 0 ? sortRaw : episodes.length + 1
    const label = String(ep.weight || ep.source_name || `第${sort}集`)

    if (seenSort.has(sort)) {
      duplicateCount++
      continue
    }
    seenSort.set(sort, true)
    episodes.push({ sort, label, url })
  }

  episodes.sort((a, b) => a.sort - b.sort)

  let host = null
  try {
    host = new URL(episodes[0].url).host
  } catch { /* 线路无可用集时留空 */ }

  return {
    index,
    name: String(line.name || `线路${index + 1}`),
    sourceKey: line.source_key || null,
    host,
    episodes,
    episodeCount: episodes.length,
    duplicateCount
  }
}

function firstYear(v) {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 4)
  if (typeof v === 'object') {
    const raw = String(v.value || v.date || '')
    const m = /(\d{4})/.exec(raw)
    return m ? m[1] : null
  }
  return null
}

function normalizeDetail(data) {
  const lines = (data.source_list_source || [])
    .map((l, i) => normalizeLine(l, i))
    .filter(l => l.episodes.length > 0)

  // 相同 URL 集合的线路只保留第一条，其余标为重复。
  const byUrls = new Map()
  for (const line of lines) {
    const key = line.episodes.map(e => e.url.replace(/\?.*$/, '')).join('|')
    if (byUrls.has(key)) {
      line.duplicateOf = byUrls.get(key).name
      continue
    }
    byUrls.set(key, line)
  }
  const uniqueLines = [...byUrls.values()]

  return {
    id: Number(data.id),
    title: String(data.title || ''),
    originalName: data.original_name || null,
    othersName: Array.isArray(data.others_name) ? data.others_name.slice(0, 3) : [],
    year: firstYear(data.release_dates && data.release_dates[0]) || firstYear(data.year) || firstYear(data.release_date),
    score: Number(data.score) || 0,
    duration: data.duration || null,
    finished: data.finished !== false,
    types: names(data.types).slice(0, 4),
    categories: names(data.category).slice(0, 4),
    areas: Array.isArray(data.area) ? data.area : data.area ? [data.area] : [],
    directors: names(data.directors).slice(0, 3),
    actors: names(data.actors).slice(0, 6),
    description: String(data.description || '').replace(/\s+/g, ' ').slice(0, 400),
    thumbnail: imageUrl(pick(data, ['thumbnail', 'tvimg'])),
    lines: uniqueLines,
    hiddenLineCount: lines.length - uniqueLines.length
  }
}

async function detail(id) {
  const { body } = await apiGet(`/video/detailv2?id=${encodeURIComponent(id)}`)
  return normalizeDetail(body.data || {})
}

module.exports = { search, detail, imageUrl, API_HOSTS, UA }
