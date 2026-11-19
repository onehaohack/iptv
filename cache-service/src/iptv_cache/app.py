from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import ClassVar

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from iptv_cache.catalog import UnknownEpisodeError
from iptv_cache.models import (
    EpisodeNumber,
    EpisodeState,
    EpisodeStatus,
    InvalidEpisodeNumberError,
    TriggerResult,
)
from iptv_cache.queue import EpisodeQueue
from iptv_cache.worker import CacheWorker


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    public_base: str
    media_dir: Path


class EpisodeResponse(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    episode: str
    status: str
    url: str | None


class TriggerResponse(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    current: EpisodeResponse
    prefetch: EpisodeResponse | None


def create_app(
    settings: ServiceSettings,
    queue: EpisodeQueue,
    worker: CacheWorker | None = None,
) -> FastAPI:
    app = FastAPI()
    app.state.queue = queue
    app.mount("/xuanan", StaticFiles(directory=settings.media_dir / "xuanan", check_dir=False))
    worker_lock = Lock()
    worker_running = False

    def _drain_queue() -> None:
        nonlocal worker_running
        if worker is None:
            return
        while (episode := queue.claim_next()) is not None:
            status = worker.cache(queue.episode(episode))
            if status is EpisodeStatus.READY:
                queue.mark_ready(episode)
            else:
                queue.mark_failed(episode)
        with worker_lock:
            worker_running = False

    def _health() -> dict[str, str]:
        return {"status": "ok"}

    def _trigger(episode: str) -> TriggerResponse:
        nonlocal worker_running
        try:
            result = queue.trigger(EpisodeNumber(episode))
        except (InvalidEpisodeNumberError, UnknownEpisodeError) as error:
            raise HTTPException(status_code=404, detail="Episode not found") from error
        if worker is not None:
            with worker_lock:
                if not worker_running:
                    worker_running = True
                    Thread(target=_drain_queue, daemon=True).start()
        return trigger_response(settings, result)

    def _status(episode: str) -> EpisodeResponse:
        try:
            episode_number = EpisodeNumber(episode)
        except InvalidEpisodeNumberError as error:
            raise HTTPException(status_code=404, detail="Episode not found") from error
        episode_status = queue.status(episode_number) or EpisodeStatus.FAILED
        return episode_response(settings, EpisodeState(episode_number, episode_status))

    app.add_api_route("/healthz", _health, methods=["GET"])
    app.add_api_route(
        "/api/v1/xuanan/episodes/{episode}/trigger",
        _trigger,
        methods=["POST"],
        response_model=TriggerResponse,
        status_code=202,
    )
    app.add_api_route(
        "/api/v1/xuanan/episodes/{episode}",
        _status,
        methods=["GET"],
        response_model=EpisodeResponse,
    )
    return app


def trigger_response(settings: ServiceSettings, result: TriggerResult) -> TriggerResponse:
    prefetch = episode_response(settings, result.prefetch) if result.prefetch is not None else None
    return TriggerResponse(current=episode_response(settings, result.current), prefetch=prefetch)


def episode_response(settings: ServiceSettings, state: EpisodeState) -> EpisodeResponse:
    url = (
        f"{settings.public_base}/xuanan/episode{state.episode.value}.mp4"
        if state.status is EpisodeStatus.READY
        else None
    )
    return EpisodeResponse(episode=state.episode.value, status=state.status.value, url=url)
