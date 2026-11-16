// 荐片下载器前端：搜索 → 选线路 → 选集 → 进度（SSE）
/* global document, window, fetch, EventSource, alert */

'use strict'

const $ = sel => document.querySelector(sel)
const state = {
  settings: null,
  keyword: '',
  page: 1,
  video: null, // detail
  probes: [],
  lineIndex: null,
  checked: new Set(),
  jobId: null,
  es: null
}

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => {
    el.textContent = ''
  }, 5000)
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `请求失败 ${res.status}`)
  return body
}

function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active')
  $(`#view-${name}`).classList.add('active')
  const order = ['search', 'line', 'episodes', 'progress']
  const idx = order.indexOf(name)
  for (const s of document.querySelectorAll('.step')) {
    const i = order.indexOf(s.dataset.step)
    s.classList.toggle('active', i === idx)
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '-'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ---------- 1. 搜索 ----------

async function doSearch(page = 1) {
  const key = $('#search-key').value.trim()
  if (!key) return
  state.keyword = key
  state.page = page
  showView('search')
  $('#search-meta').textContent = '搜索中…'
  $('#search-results').innerHTML = ''
  try {
    const data = await api(`/api/search?key=${encodeURIComponent(key)}&page=${page}`)
    $('#search-meta').textContent = `“${key}” 共 ${data.total} 条，本页 ${data.results.length} 条`
    renderResults(data.results)
    renderPager(data)
  } catch (e) {
    $('#search-meta').textContent = ''
    toast(e.message)
  }
}

function renderResults(items) {
  const ul = $('#search-results')
  ul.innerHTML = items
    .map(
      it => `
      <li class="result" data-id="${it.id}">
        ${it.thumbnail ? `<img src="${esc(it.thumbnail)}" alt="" loading="lazy" />` : '<div class="noimg"></div>'}
        <div class="result-body">
          <div class="result-title">${esc(it.title)} ${it.years && it.years[0] ? `<span class="result-sub">${esc(it.years[0])}</span>` : ''}</div>
          <div class="result-sub">${esc((it.types || []).join(' / '))}${it.areas && it.areas.length ? ' · ' + esc(it.areas.join('/')) : ''}${it.score ? ' · ' + esc(it.score) + ' 分' : ''}</div>
          <div class="result-sub">${esc((it.actors || []).join('、'))}</div>
          <div class="result-sub">${esc(it.description)}</div>
        </div>
      </li>`
    )
    .join('')
  for (const li of ul.querySelectorAll('.result')) {
    li.addEventListener('click', () => openVideo(Number(li.dataset.id)))
  }
}

function renderPager(data) {
  const pager = $('#search-pager')
  const hasMore = data.page * data.pageSize < data.total
  pager.innerHTML = `${data.page > 1 ? '<button class="btn ghost" data-nav="prev">上一页</button>' : ''}
    <span class="meta">第 ${data.page} 页</span>
    ${hasMore ? '<button class="btn ghost" data-nav="next">下一页</button>' : ''}`
  for (const b of pager.querySelectorAll('button')) {
    b.addEventListener('click', () => doSearch(data.page + (b.dataset.nav === 'next' ? 1 : -1)))
  }
}

// ---------- 2. 线路 ----------

async function openVideo(id) {
  showView('line')
  $('#video-head').innerHTML = '<div class="result-sub">加载详情中…</div>'
  $('#line-list').innerHTML = ''
  $('#probe-meta').textContent = '正在读取线路…'
  try {
    const detail = await api(`/api/detail?id=${id}`)
    state.video = detail
    state.probes = []
    state.lineIndex = null
    renderVideoHead(detail)
    loadProbes(false)
  } catch (e) {
    $('#probe-meta').textContent = ''
    toast(e.message)
  }
}

function renderVideoHead(v) {
  $('#video-head').innerHTML = `
    ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" />` : ''}
    <div>
      <div class="result-title">${esc(v.title)}${v.year ? ` <span class="result-sub">${esc(v.year)}</span>` : ''}</div>
      <div class="result-sub">${esc((v.types || []).join(' / '))}${v.areas && v.areas.length ? ' · ' + esc(v.areas.join('/')) : ''}${v.score ? ' · ' + esc(v.score) + ' 分' : ''}</div>
      <div class="result-sub">${esc((v.directors || []).join('、'))} ${v.actors && v.actors.length ? ' / ' + esc(v.actors.join('、')) : ''}</div>
      <div class="result-sub">${esc(v.description)}</div>
    </div>`
}

async function loadProbes(force) {
  if (!state.video) return
  $('#probe-meta').textContent = force ? '重新体检线路…' : '正在体检线路，请稍候…（剧集只抽测几集）'
  try {
    const data = await api(`/api/probe?id=${state.video.id}${force ? '&force=1' : ''}`)
    state.probes = data.probes
    renderLines()
    const usable = data.probes.filter(p => p.usable).length
    $('#probe-meta').textContent = `共 ${data.probes.length} 条线路，${usable} 条可用${data.probes.length - usable ? `，${data.probes.length - usable} 条连不上` : ''}`
  } catch (e) {
    $('#probe-meta').textContent = ''
    toast(e.message)
  }
}

function renderLines() {
  const ul = $('#line-list')
  ul.innerHTML = state.probes
    .map(p => {
      const dead = !p.usable
      const badge = p.usable ? '<span class="badge ok">可用</span>' : '<span class="badge bad">连不上</span>'
      return `
      <li class="line ${dead ? 'dead' : ''}" data-index="${p.index}">
        <div class="line-name">${esc(p.name)}</div>
        ${badge}
        <div class="line-stats">
          <span>${p.sampled ? `抽测 ${p.alive}/${p.total} 集（共 ${p.episodeCount} 集）` : `${p.alive}/${p.total} 集`}</span>
          ${p.resolution ? `<span>${esc(p.resolution)}</span>` : ''}
          ${p.mbps ? `<span>${p.mbps.toFixed(2)} MB/s</span>` : ''}
          ${p.host ? `<span>${esc(p.host)}</span>` : ''}
          ${p.avgSegmentDuration ? `<span>每集约 ${fmtDuration(p.avgSegmentDuration)}</span>` : ''}
        </div>
      </li>`
    })
    .join('')

  for (const li of ul.querySelectorAll('.line')) {
    if (li.classList.contains('dead')) continue
    li.addEventListener('click', () => {
      state.lineIndex = Number(li.dataset.index)
      for (const x of ul.querySelectorAll('.line')) x.classList.remove('selected')
      li.classList.add('selected')
      openEpisodes()
    })
  }
}

// ---------- 3. 选集 ----------

function currentProbe() {
  return state.probes.find(p => p.index === state.lineIndex) || null
}

function openEpisodes() {
  if (!state.video || state.lineIndex == null) return
  showView('episodes')
  const probe = currentProbe()
  const line = state.video.lines.find(l => l.index === state.lineIndex)
  if (!line) return

  $('#episode-head').innerHTML = `
    ${state.video.thumbnail ? `<img src="${esc(state.video.thumbnail)}" alt="" />` : ''}
    <div>
      <div class="result-title">${esc(state.video.title)} <span class="badge ok">${esc(line.name)}</span></div>
      <div class="result-sub">共 ${line.episodeCount} 集${probe && probe.resolution ? ' · ' + esc(probe.resolution) : ''}${line.duplicateCount ? ` · 该线路有 ${line.duplicateCount} 个重复集号已合并` : ''}</div>
    </div>`

  state.checked = new Set(line.episodes.map(e => e.sort))
  const ul = $('#episode-list')
  ul.innerHTML = line.episodes
    .map(
      e => `<li class="episode"><input type="checkbox" checked data-sort="${e.sort}" id="ep-${e.sort}" /><label for="ep-${e.sort}">${esc(e.label)}</label></li>`
    )
    .join('')
  for (const cb of ul.querySelectorAll('input')) {
    cb.addEventListener('change', () => {
      const sort = Number(cb.dataset.sort)
      if (cb.checked) state.checked.add(sort)
      else state.checked.delete(sort)
    })
  }

  refreshStartBar()
}

function refreshStartBar() {
  const root = state.settings ? state.settings.downloadRoot : ''
  $('#start-dir').textContent = `${root}/${state.video ? state.video.title : ''}`
  $('#start-free').textContent = state.settings && state.settings.freeText ? `剩余 ${state.settings.freeText}` : ''
  $('#start-download').disabled = state.checked.size === 0
}

async function startDownload() {
  if (!state.video || state.lineIndex == null) return
  const episodes = [...state.checked]
  if (!episodes.length) return toast('没有选中任何集')

  const btn = $('#start-download')
  btn.disabled = true
  btn.textContent = '创建任务…'
  try {
    const res = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ videoId: state.video.id, lineIndex: state.lineIndex, episodes })
    })
    openProgress(res.id)
  } catch (e) {
    toast(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '开始下载'
  }
}

// ---------- 4. 进度 ----------

function openProgress(jobId) {
  state.jobId = jobId
  showView('progress')
  if (state.es) {
    state.es.close()
    state.es = null
  }
  $('#progress-head').innerHTML = '<div class="result-sub">任务加载中…</div>'
  $('#progress-list').innerHTML = ''

  const es = new EventSource(`/api/jobs/${jobId}/events`)
  state.es = es
  es.addEventListener('job', ev => {
    const d = JSON.parse(ev.data)
    if (d.targetDir) {
      $('#progress-head').innerHTML = `
        <div>
          <div class="result-title">${esc(d.title || '')} 下载任务</div>
          <div class="result-sub">保存到 ${esc(d.targetDir)}</div>
        </div>`
    }
    if (d.summary) renderSummary(d.summary, d.status)
    if (d.status === 'done' || d.status === 'partial' || d.status === 'failed' || d.status === 'cancelled') {
      es.close()
      state.es = null
      toast(`任务${d.status === 'done' ? '完成' : d.status === 'cancelled' ? '已取消' : '结束'}：${d.summary ? d.summary.doneEpisodes + '/' + d.summary.totalEpisodes + ' 集' : ''}`)
    }
  })
  es.addEventListener('episode', ev => {
    const d = JSON.parse(ev.data)
    renderEpisodeRow(d.episode)
    if (d.summary) renderSummary(d.summary)
  })
  es.onerror = () => {
    // 服务端在任务结束后会关闭流，这里不报错。
  }
}

function renderSummary(s, status) {
  $('#job-summary').innerHTML = `
    <div class="result-sub">
      ${status ? `<span class="badge ${statusClass(status)}">${esc(statusLabel(status))}</span> ` : ''}
      ${s.doneEpisodes}/${s.totalEpisodes} 集完成${s.failedEpisodes ? `，${s.failedEpisodes} 集失败` : ''} ·
      分片 ${s.segmentDone}/${s.segmentTotal} · 已下载 ${fmtBytes(s.bytesDone)}
    </div>
    <div class="bar" style="margin-top:8px"><i style="width:${s.percent}%"></i></div>`
}

function statusClass(s) {
  if (s === 'done') return 'ok'
  if (s === 'failed' || s === 'cancelled') return 'bad'
  if (s === 'partial' || s === 'paused') return 'warn'
  return ''
}

function statusLabel(s) {
  return { queued: '排队中', running: '下载中', paused: '已暂停', done: '完成', failed: '失败', partial: '部分完成', cancelled: '已取消' }[s] || s
}

const STATUS_TEXT = {
  queued: '排队',
  downloading: '下载分片',
  assembling: '拼接',
  remuxing: '转封装',
  done: '完成',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消'
}

function renderEpisodeRow(ep) {
  let row = document.querySelector(`#prog-${ep.sort}`)
  if (!row) {
    row = document.createElement('li')
    row.id = `prog-${ep.sort}`
    row.className = 'progress-row'
    $('#progress-list').appendChild(row)
  }
  const cls = ep.status === 'done' ? 'done' : ep.status === 'failed' ? 'failed' : ''
  row.className = `progress-row ${cls}`
  const detail =
    ep.status === 'done'
      ? `<span class="badge ok">完成</span> ${esc(ep.outputFile || '')}`
      : ep.status === 'failed'
        ? `<span class="err">${esc(ep.error || '失败')}</span>`
        : ep.status === 'downloading'
          ? `${ep.segmentDone}/${ep.segmentTotal} 分片 · ${fmtBytes(ep.bytesDone)} · ${ep.mbps.toFixed(2)} MB/s`
          : `<span class="badge ${statusClass(ep.status)}">${esc(STATUS_TEXT[ep.status] || ep.status)}</span>`

  row.innerHTML = `
    <div class="progress-name">${esc(ep.label || `第${ep.sort}集`)}</div>
    <div class="bar"><i style="width:${ep.percent}%"></i></div>
    <div class="progress-detail">
      ${detail}
      ${ep.warning ? `<div class="warn">${esc(ep.warning)}</div>` : ''}
      ${ep.cutSec >= 1 ? `<div class="warn">已剪掉 ${Math.round(ep.cutSec)} 秒插播广告</div>` : ''}
      ${ep.fallbackFrom ? `<div class="warn">已自动换线路：${esc(ep.fallbackFrom)} → ${esc(ep.lineName || '')}</div>` : ''}
      ${ep.status === 'failed' ? `<button class="btn ghost" data-retry="${ep.sort}">重试</button>` : ''}
    </div>`

  const retry = row.querySelector('[data-retry]')
  if (retry) {
    retry.addEventListener('click', async () => {
      try {
        await api(`/api/jobs/${state.jobId}/retry?sort=${ep.sort}`, { method: 'POST' })
      } catch (e) {
        toast(e.message)
      }
    })
  }
}

// ---------- 历史 ----------

async function loadHistory() {
  showView('history')
  const ul = $('#history-list')
  ul.innerHTML = '<li class="meta">加载中…</li>'
  try {
    const data = await api('/api/jobs')
    if (!data.jobs.length) {
      ul.innerHTML = '<li class="meta">还没有下载任务。</li>'
      return
    }
    ul.innerHTML = data.jobs
      .map(
        j => `<li class="history-row">
        <div class="grow">
          <div class="result-title">${esc(j.title)}</div>
          <div class="result-sub">${esc(j.lineName || '')} · ${j.summary.doneEpisodes}/${j.summary.totalEpisodes} 集 · ${fmtBytes(j.summary.bytesDone)}${j.targetDir ? ' · ' + esc(j.targetDir) : ''}</div>
        </div>
        <span class="badge ${statusClass(j.status)}">${esc(statusLabel(j.status))}</span>
        <button class="btn ghost" data-open="${j.id}">查看进度</button>
      </li>`
      )
      .join('')
    for (const b of ul.querySelectorAll('[data-open]')) {
      b.addEventListener('click', () => openProgress(b.dataset.open))
    }
  } catch (e) {
    ul.innerHTML = `<li class="meta">${esc(e.message)}</li>`
  }
}

// ---------- 设置 ----------

async function loadSettings() {
  state.settings = await api('/api/settings')
  $('#root-info').textContent = `下载目录 ${state.settings.downloadRoot}${state.settings.mountPoint ? `（盘 ${state.settings.mountPoint}）` : ''} 剩余 ${state.settings.freeText || '-'}`
  $('#cfg-root').value = state.settings.downloadRoot
  $('#cfg-ep').value = state.settings.episodeConcurrency
  $('#cfg-seg').value = state.settings.segmentConcurrency
  $('#cfg-fallback').checked = state.settings.autoFallback
  $('#cfg-remux').checked = state.settings.remuxToMp4
  $('#cfg-path').textContent = state.settings.configPath
  $('#cfg-root-hint').textContent = `并发 ${state.settings.episodeConcurrency} 集 × ${state.settings.segmentConcurrency} 分片`
  if (state.video) refreshStartBar()
}

async function saveSettings(patch) {
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
    $('#settings-msg').textContent = '已保存'
    setTimeout(() => {
      $('#settings-msg').textContent = ''
    }, 3000)
    await loadSettings()
    return true
  } catch (e) {
    $('#settings-msg').textContent = e.message
    toast(e.message)
    return false
  }
}

// ---------- 事件绑定 ----------

function bind() {
  $('#search-form').addEventListener('submit', e => {
    e.preventDefault()
    doSearch(1)
  })
  $('#back-to-search').addEventListener('click', () => showView('search'))
  $('#reprobe').addEventListener('click', () => loadProbes(true))
  $('#back-to-line').addEventListener('click', () => {
    showView('line')
    renderLines()
  })
  $('#select-all').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('#episode-list input')) {
      cb.checked = true
      state.checked.add(Number(cb.dataset.sort))
    }
    refreshStartBar()
  })
  $('#select-none').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('#episode-list input')) cb.checked = false
    state.checked.clear()
    refreshStartBar()
  })
  $('#start-download').addEventListener('click', startDownload)
  $('#back-to-episodes').addEventListener('click', () => {
    if (state.es) {
      state.es.close()
      state.es = null
    }
    openEpisodes()
  })
  $('#pause-job').addEventListener('click', async () => {
    try {
      await api(`/api/jobs/${state.jobId}/pause`)
      toast('已暂停，已下载的分片会保留，可稍后重试')
    } catch (e) {
      toast(e.message)
    }
  })
  $('#cancel-job').addEventListener('click', async () => {
    if (!confirm('取消任务？已下载完成的文件不会被删除。')) return
    try {
      await api(`/api/jobs/${state.jobId}/cancel`)
    } catch (e) {
      toast(e.message)
    }
  })
  $('#reveal-dir').addEventListener('click', async () => {
    try {
      const r = await api('/api/reveal', { method: 'POST', body: JSON.stringify({ jobId: state.jobId }) })
      toast(`已打开 ${r.opened}`)
    } catch (e) {
      toast(e.message)
    }
  })
  $('#toggle-history').addEventListener('click', loadHistory)

  $('#open-settings').addEventListener('click', () => {
    $('#settings-panel').classList.remove('hidden')
    loadSettings().catch(e => toast(e.message))
  })
  $('#close-settings').addEventListener('click', () => $('#settings-panel').classList.add('hidden'))
  $('#save-settings').addEventListener('click', () =>
    saveSettings({
      downloadRoot: $('#cfg-root').value.trim(),
      episodeConcurrency: Number($('#cfg-ep').value),
      segmentConcurrency: Number($('#cfg-seg').value),
      autoFallback: $('#cfg-fallback').checked,
      remuxToMp4: $('#cfg-remux').checked
    })
  )
  $('#cfg-pick').addEventListener('click', async () => {
    $('#settings-msg').textContent = '等待选择目录…'
    try {
      const next = await api('/api/pick-folder', { method: 'POST' })
      state.settings = next
      await loadSettings()
      $('#settings-msg').textContent = '已切换到新目录'
    } catch (e) {
      $('#settings-msg').textContent = e.message
    }
  })
}

async function main() {
  bind()
  try {
    await loadSettings()
  } catch (e) {
    toast(`读取设置失败：${e.message}`)
  }
  showView('search')
}

main()
