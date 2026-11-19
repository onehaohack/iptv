from pathlib import Path

from fastapi.testclient import TestClient

from iptv_cache.app import ServiceSettings, create_app
from iptv_cache.catalog import Catalog, Episode
from iptv_cache.models import EpisodeNumber
from iptv_cache.queue import EpisodeQueue

HTTP_ACCEPTED = 202
HTTP_NOT_FOUND = 404


def create_client(media_dir: Path) -> tuple[TestClient, EpisodeQueue]:
    catalog = Catalog(
        (
            Episode(EpisodeNumber("01"), "https://primary/01", "https://fallback/01"),
            Episode(EpisodeNumber("02"), "https://primary/02", "https://fallback/02"),
        )
    )
    queue = EpisodeQueue(catalog)
    settings = ServiceSettings("http://192.168.1.5:8788", media_dir)
    return TestClient(create_app(settings, queue)), queue


def test_trigger_returns_selected_and_prefetch_episode(tmp_path: Path) -> None:
    client, _ = create_client(tmp_path)

    response = client.post("/api/v1/xuanan/episodes/01/trigger")

    assert response.status_code == HTTP_ACCEPTED
    assert response.json()["current"]["episode"] == "01"
    assert response.json()["prefetch"]["episode"] == "02"


def test_ready_episode_exposes_lan_url_only(tmp_path: Path) -> None:
    client, queue = create_client(tmp_path)
    queue.mark_ready(EpisodeNumber("01"))

    response = client.get("/api/v1/xuanan/episodes/01")

    assert response.json() == {
        "episode": "01",
        "status": "ready",
        "url": "http://192.168.1.5:8788/xuanan/episode01.mp4",
    }


def test_invalid_episode_is_not_found(tmp_path: Path) -> None:
    client, _ = create_client(tmp_path)
    response = client.get("/api/v1/xuanan/episodes/18")

    assert response.status_code == HTTP_NOT_FOUND
