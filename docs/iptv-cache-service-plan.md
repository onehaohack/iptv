# IPTV Cache Service Implementation Plan

**Goal:** Cache only the 17 episodes of 《悬案》 on `onehdd` and serve completed MP4 files over the LAN.

**Architecture:** A user-level FastAPI service exposes completed MP4 files below `/vol2/iptv-cache/xuanan` on port 8788. The TV box triggers caching for the selected episode and queues its successor for prefetch; a single FFmpeg worker copies only allowlisted primary/fallback sources and exposes a file only after FFprobe verification.

**Verification:** Shell syntax checks; systemd user units active; HTTP GET of the generated playlist; inspect the cache job journal and completed media file.

1. Install the allowlisted 17-episode catalog and Python service under `/home/onehao/iptv-cache-service`.
2. Install `iptv-cache.service` as a user-level systemd unit and create `/vol2/iptv-cache`.
3. Enable the service; it serves `/healthz`, episode status, trigger endpoints, and ready MP4 files on port 8788.
4. Verify the first trigger transitions the current episode to `downloading` or `ready` and queues the following episode.
