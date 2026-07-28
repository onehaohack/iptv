from iptv_cache.catalog import Catalog, Episode
from iptv_cache.models import EpisodeNumber, EpisodeStatus
from iptv_cache.queue import EpisodeQueue


def episode(number: str) -> Episode:
    return Episode(
        number=EpisodeNumber(number),
        primary_url=f"https://primary.example/{number}.m3u8",
        fallback_url=f"https://fallback.example/{number}.m3u8",
    )


def test_trigger_prioritizes_selected_episode_and_prefetches_next() -> None:
    queue = EpisodeQueue(Catalog((episode("01"), episode("02"))))

    result = queue.trigger(EpisodeNumber("01"))

    assert result.current.status is EpisodeStatus.QUEUED
    assert result.prefetch is not None
    assert result.prefetch.status is EpisodeStatus.QUEUED
    assert queue.next_episode() == EpisodeNumber("01")


def test_repeated_trigger_does_not_duplicate_an_episode() -> None:
    queue = EpisodeQueue(Catalog((episode("01"), episode("02"))))

    _ = queue.trigger(EpisodeNumber("01"))
    _ = queue.trigger(EpisodeNumber("01"))

    assert queue.pending_episodes() == (EpisodeNumber("01"), EpisodeNumber("02"))
