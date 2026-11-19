from __future__ import annotations

import os
from pathlib import Path

import uvicorn

from iptv_cache.app import ServiceSettings, create_app
from iptv_cache.catalog import Catalog
from iptv_cache.queue import EpisodeQueue
from iptv_cache.worker import CacheWorker, SubprocessRunner


def main() -> None:
    data_dir = Path(os.environ.get("IPTV_CACHE_DATA_DIR", "/vol2/iptv-cache"))
    public_base = os.environ.get("IPTV_CACHE_PUBLIC_BASE", "http://192.168.1.5:8788")
    catalog = Catalog.from_tsv(Path.cwd() / "catalog" / "xuanan.tsv")
    queue = EpisodeQueue(catalog)
    app = create_app(
        ServiceSettings(public_base, data_dir),
        queue,
        CacheWorker(SubprocessRunner(), data_dir),
    )
    uvicorn.run(app, host="0.0.0.0", port=8788)
