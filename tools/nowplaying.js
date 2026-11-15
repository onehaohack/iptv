(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  ws.onopen = async () => {
    await send('Runtime.enable');
    const expr = `JSON.stringify({
      title: (document.querySelector('h1, .title, .video-title')||{}).innerText || document.title,
      text: document.body.innerText.slice(0, 200),
      videos: [...document.querySelectorAll('video')].map(v => ({src: v.src, currentTime: v.currentTime, duration: v.duration, paused: v.paused})),
      m3u8: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('.m3u8'))
    })`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(r.result.value);
    ws.close(); process.exit(0);
  };
})();
