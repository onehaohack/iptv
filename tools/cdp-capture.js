// 通过 CDP 记录 Electron 渲染进程的完整网络请求
const fs = require('fs');

const OUT = process.argv[2] || '/tmp/cdp-net.log';
const DURATION_MS = parseInt(process.argv[3] || '300000', 10);
const port = 9222;

const out = fs.createWriteStream(OUT, { flags: 'w' });
const log = (...a) => { const line = a.join(' '); out.write(line + '\n'); console.log(line); };

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  const reqs = new Map();

  ws.onopen = async () => {
    log(`# attached: ${page.title} ${page.url}`);
    ws.send(JSON.stringify({ id: ++id, method: 'Network.enable', params: {
      maxTotalBufferSize: 200 * 1024 * 1024,
      maxResourceBufferSize: 50 * 1024 * 1024,
      maxPostDataSize: 5 * 1024 * 1024,
    }}));
    ws.send(JSON.stringify({ id: ++id, method: 'Page.enable' }));
    ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
    log('# recording...');
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).res(msg.result); pending.delete(msg.id); return; }
    if (!msg.method) return;
    const p = msg.params || {};
    if (msg.method === 'Network.requestWillBeSent') {
      const r = p.request;
      reqs.set(p.requestId, { url: r.url, method: r.method, headers: r.headers, ts: Date.now() });
      log(`REQ ${r.method} ${r.url}`);
      const h = r.headers || {};
      const interesting = ['referer', 'user-agent', 'authorization', 'x-token', 'cookie', 'range'];
      interesting.forEach(k => { if (h[k]) log(`    ${k}: ${h[k]}`); });
      if (r.postData) log(`    body: ${String(r.postData).slice(0, 500)}`);
    } else if (msg.method === 'Network.responseReceived') {
      const r = p.response;
      log(`RES ${r.status} ${r.mimeType} ${r.url}`);
    } else if (msg.method === 'Network.loadingFailed') {
      const r = reqs.get(p.requestId);
      log(`ERR ${p.errorText} ${r ? r.url : p.requestId}`);
    } else if (msg.method === 'Network.webSocketCreated') {
      log(`WS  ${p.url}`);
    }
  };

  ws.onerror = (e) => log('# ws error ' + (e.message || e));

  setTimeout(() => {
    log('# done');
    try { ws.close(); } catch {}
    out.end(() => process.exit(0));
  }, DURATION_MS);
})();
