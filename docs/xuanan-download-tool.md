# 《悬案》MP4 下载工具

当前生产方案是手动下载工具，不启用播放触发缓存服务。

部署主机：`onehao@192.168.1.5`

- 工具：`/home/onehao/iptv-cache-service/bin/download-xuanan`
- 缓存：`/vol2/@team/1Tdiskteam/media/xuanan/NN.mp4`（如第 05 集为 `05.mp4`）
- 播放列表：`/vol2/@team/1Tdiskteam/media/xuanan.m3u`
- 局域网媒体服务：`http://192.168.1.5:8788`

## 使用

```bash
# 下载一集，主源失败自动使用备用源
/home/onehao/iptv-cache-service/bin/download-xuanan 01

# 下载全部 17 集
/home/onehao/iptv-cache-service/bin/download-xuanan all

# 查看已完成文件和播放列表
find /vol2/@team/1Tdiskteam/media/xuanan -type f -name '*.mp4' -printf '%f %s bytes\n'
curl --fail http://127.0.0.1:8788/xuanan.m3u
```

工具只接受 `01` 到 `17` 或 `all`。每集先写入隐藏的 `.part.mp4` 临时文件，经 FFprobe 校验后才改名为 MP4；播放列表只包含已完成文件。

静态媒体服务由 `systemctl --user status iptv-cache-http.service` 管理，已设置为开机启动。
