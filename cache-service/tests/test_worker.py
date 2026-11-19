from pathlib import Path

from iptv_cache.catalog import Episode
from iptv_cache.models import EpisodeNumber, EpisodeStatus
from iptv_cache.worker import CacheWorker, CommandResult


class FakeRunner:
    def __init__(self, results: tuple[CommandResult, ...]) -> None:
        self._results = list(results)
        self.urls: list[str] = []

    def run(self, command: tuple[str, ...]) -> CommandResult:
        result = self._results.pop(0)
        if command[0] == "ffmpeg":
            self.urls.append(command[command.index("-i") + 1])
        if result.success and command[0] == "ffmpeg":
            Path(command[-1]).touch()
        return result


def test_worker_uses_fallback_when_primary_fails(tmp_path: Path) -> None:
    runner = FakeRunner(
        (CommandResult(success=False), CommandResult(success=True), CommandResult(success=True))
    )
    worker = CacheWorker(runner, tmp_path)
    episode = Episode(EpisodeNumber("01"), "https://primary/01", "https://fallback/01")

    status = worker.cache(episode)

    assert status is EpisodeStatus.READY
    assert runner.urls == ["https://primary/01", "https://fallback/01"]
    assert (tmp_path / "xuanan/episode01.mp4").is_file()


def test_worker_never_publishes_partial_media(tmp_path: Path) -> None:
    runner = FakeRunner((CommandResult(success=False), CommandResult(success=False)))
    worker = CacheWorker(runner, tmp_path)
    episode = Episode(EpisodeNumber("01"), "https://primary/01", "https://fallback/01")

    status = worker.cache(episode)

    assert status is EpisodeStatus.FAILED
    assert not (tmp_path / "xuanan/episode01.mp4").exists()
