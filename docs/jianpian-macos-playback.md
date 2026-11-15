# 荐片 macOS 客户端播放链路排查记录

日期：2026-11-14 / 2026-11-15
对象：本机 `/Applications/荐片.app`（Bundle ID `com.jianpian.macos`，版本 5.0.4，Electron 22.3.27 / Chrome 108）

## 抓取方法

Electron 支持 Chromium 远程调试端口。带该参数重启一次客户端后，用 CDP 的 `Network.*`
事件记录渲染进程发出的全部请求：

```bash
osascript -e 'tell application "荐片" to quit'
nohup "/Applications/荐片.app/Contents/MacOS/荐片" \
  --remote-debugging-port=9222 "--remote-allow-origins=*" >/tmp/jp_app.log 2>&1 &

# 确认目标已出现
curl -s http://127.0.0.1:9222/json/list

# 记录请求（脚本见本仓库 tools/cdp-capture.js）
node tools/cdp-capture.js net.log 1200000
```

`tools/nowplaying.js` 用于读取当前 `<video>` 元素的播放进度和已加载的 m3u8，
判断「此刻实际生效的是哪条线路」。

注意：本机流量走 FlClash 代理（`127.0.0.1:7890`），所以 `lsof` 只能看到到代理的连接，
看不到真实域名；必须用 CDP 或读取 `performance.getEntriesByType('resource')`。

## 域名分工

| 域名 | 角色 |
| --- | --- |
| `japi.zxfmj.com` | 业务 API（本次启动后使用的入口） |
| `sl6eqz.zxfmj.com` | 同一套 API 的另一个入口（早前会话中出现） |
| `vip.dytt-tvs.com` | HLS 视频 CDN，实际出片源的一条线路 |
| `mv.gzlcl.com` | 「VIP 线路」接口，当前不可用 |
| `img.cqkgy.com` | 海报 / 轮播图 CDN |
| `127.0.0.1:5800` | 客户端本地辅助服务（`/api/v1/setpath`，外部播放器 / 投屏集成） |
| `d.alicdn.com`、`umini.shujupie.com` | 阿里、友盟统计 |

## 播放链路结构

1. 详情接口返回剧集目录与线路列表：
   `GET https://japi.zxfmj.com/api/video/detailv2?id=<detail id>`
2. 主播放列表（master）：`.../index.m3u8`，约 96 字节，只列出码率档位。
3. 码率列表：`.../<bitrate>k/hls/mixed.m3u8`，`#EXT-X-PLAYLIST-TYPE:VOD`，分片约 8 秒。
4. 分片：`.../<bitrate>k/hls/<md5>.ts?hash=<64 hex>`。

`hash` 是播放列表内自带的固定参数，不是逐次签名的临时 token；路径中的日期目录
（如 `20261105`）随片源更新变化，所以这类地址不适合长期留存。

## 本次观测到的两条线路状态

| 剧目 | master m3u8 | 结果 |
| --- | --- | --- |
| 谷雨（detail id 575987） | `https://vip.dytt-tvs.com/20261105/44126_7e94cbdb/index.m3u8` | HTTP 200，96 B，`1920x800` |
| 我不是大师（detail id 575636） | `https://vip.dytt-tvs.com/20260924/38401_a1f82b23/index.m3u8` | HTTP 200，96 B，`1920x960` |

「VIP 线路」的接口不可用：

```
ERR net::ERR_CONNECTION_CLOSED  https://mv.gzlcl.com/api/v2/vip/normal/1676171/index.m3u8
ERR net::ERR_ABORTED            https://mv.gzlcl.com/api/v2/vip/normal/1676171/index.m3u8
```

本机 `curl` 复现同样失败（`http=000`），说明是服务端 / CDN 侧问题，不是本机代理或解码问题。
客户端行为是先试 VIP 线路、失败后自动回退到 `dytt-tvs`，所以播放本身正常，
但「换源」列表里 VIP 线路点了不会有反应。

## 排障结论

- 播放卡顿偶发时，先分清是 `dytt-tvs` 的瞬时抖动（本次出现过一次 `http=000`，重试即恢复）
  还是线路整体不可用（`mv.gzlcl.com` 属于后者）。
- 画质与预期不符时，看 master m3u8 里的 `RESOLUTION` 和码率目录（本次只有单一 `3000k` 档）。
- 判断当前真实生效的线路，用 `tools/nowplaying.js` 读 `<video>` 与已加载的 m3u8，
  比看 UI 上的「换源」标签可靠。

## 边界说明

本仓库只记录**当前正在播放的单条源**和排障所需的接口结论，用于本机播放故障定位。
不批量枚举整部剧各集的播放地址、不导出片源清单、不做下载分发；
这类内容多为第三方聚合的未授权片源，`hash` 参数也可能随服务端调整失效。
