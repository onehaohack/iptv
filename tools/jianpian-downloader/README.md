# 荐片下载器

本机自用的「荐片」离线下载工具：按片名搜索，列出可用线路，勾选集数，下载成 MP4。

- 零 npm 依赖，只用 Node 内置模块（`node:http`、内置 `fetch`）
- 界面是本地网页，默认 <http://127.0.0.1:8790>
- 下载过程逐集显示分片进度、速度；支持暂停/取消/重试、续传、历史记录
- 转 MP4 用自带的 Swift 直通转封装（AVFoundation），不重编码，顺手剪掉流里插播的广告

## 运行

```sh
cd tools/jianpian-downloader
node server.js            # 默认 8790
node server.js --port=8080
```

首次下载时 `native/remux.swift` 会用 `swiftc` 编译到 `build/remux`（约 10 秒），之后复用。

### Linux 上部署（远程机器）

Linux 没有 swiftc/avconvert，转封装交给外部命令（ffmpeg 直通拷贝，不剪广告）：

```sh
JIANPIAN_REMUX_CMD='ffmpeg -y -fflags +genpts -i {input} -c copy -map 0 {output}' \
  node server.js --port=8790 --host=0.0.0.0
```

`--host=0.0.0.0` 让局域网能访问；默认只监听 127.0.0.1。远程机器上的 systemd 单元见
`tools/jianpian-downloader/deploy/jianpian.service`。

## 说明

- 详情接口固定为 `https://japi.zxfmj.com/api/video/detailv2?id=<id>`，对应 Mac 版「荐片」App 的数据源。
- 文件名按媒体库习惯命名：多集 `剧名 S01E03.mp4`，电影 `剧名.mp4`，便于飞牛影视 / Emby / Plex 刮削。
- 线路列表里的 `VIP线路` 通常分片最少、最稳；`高清线路1` 等线路会夹广告、个别分片残缺。
  下载中途不会自动换线路，失败就重试同一线路。
- 剧集的线路体检是抽样（第 1 集 + 均匀抽几集，含末集），几秒出结果；整条线路连不上靠抽样即可判负，
  个别集缺片由下载时的重试兜底。电影仍是全量体检。
- 转封装失败时保留 `.ts` 并在界面提示，不会让整集白下。

## 目录

```
server.js            HTTP 服务、API、SSE 推送
lib/jianpian.js      荐片搜索 / 详情解析
lib/hls.js           m3u8 解析（master + media）
lib/crypto-hls.js    AES-128 分片解密
lib/downloader.js    分片下载、拼接、调用转封装
lib/remux.js         编译并调用 native/remux
lib/scheduler.js     任务队列、并发、暂停/取消/重试
lib/job-store.js     任务历史持久化
lib/paths.js         目录与文件名、磁盘空间
public/              前端页面
native/remux.swift   TS → MP4 直通转封装（剪广告）
```
