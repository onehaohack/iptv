#!/usr/bin/env node
// 按片名搜索荐片，输出对应的详情接口链接（detailv2）。
// 用法: node tools/jianpian-search.js <片名> [page]
//   node tools/jianpian-search.js 冬城猎凶
//   node tools/jianpian-search.js 龙餐馆 2

const API = process.env.JP_API || 'https://japi.zxfmj.com';

function pick(o, keys) {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
  return null;
}

// 递归收集「带片名的 id」。响应里同时带有分类节点（电影/剧情/战争等），
// 它们的 id 很小且不是影片，按名称黑名单 + id 上限过滤掉。
const CATEGORY_NAMES = new Set([
  '电视剧', '电影', '综艺', '动漫', '纪录片', '短剧', '国产', '港台', '日韩', '欧美',
  '其他', '全部', '动作', '喜剧', '剧情', '爱情', '科幻', '恐怖', '悬疑', '犯罪',
  '战争', '动画', '家庭', '历史', '惊悚', '冒险', '音乐', '运动', '真人秀', '奇幻',
]);

function collect(node, out = [], depth = 0) {
  if (node == null || depth > 6) return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, depth + 1);
    return out;
  }
  if (typeof node === 'object') {
    const id = pick(node, ['video_id', 'videoId', 'detail_id', 'detailId', 'id']);
    const name = pick(node, ['name', 'title', 'video_name', 'videoName']);
    if (id != null && typeof name === 'string' && !CATEGORY_NAMES.has(name) && Number(id) > 1000) {
      out.push({ id, name });
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') collect(v, out, depth + 1);
    }
  }
  return out;
}

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: node tools/jianpian-search.js <片名> [page]');
    process.exit(2);
  }
  const page = Number(process.argv[3] || 1);
  const url = `${API}/api/v2/search/videoV2?key=${encodeURIComponent(key)}&page=${page}`;

  const res = await fetch(url, {
    // HTTP header 只允许 latin1，UA 里不能出现中文。
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Jianpian/5.0.4' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status} from ${url}`);
    process.exit(1);
  }
  const body = await res.json();

  const seen = new Map();
  for (const { id, name } of collect(body.data ?? body)) {
    if (!seen.has(String(id))) seen.set(String(id), name);
  }

  if (seen.size === 0) {
    console.error('未解析到结果。原始响应前 500 字符：');
    console.error(JSON.stringify(body).slice(0, 500));
    process.exit(1);
  }

  // 片名包含搜索词的排在前面。
  const rows = [...seen].sort((a, b) => {
    const ai = a[1].includes(key) ? 0 : 1;
    const bi = b[1].includes(key) ? 0 : 1;
    return ai - bi;
  });

  for (const [id, name] of rows) {
    console.log(`${name}\t${API}/api/video/detailv2?id=${id}`);
  }
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
