from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, final

from iptv_cache.catalog import Episode
from iptv_cache.models import EpisodeStatus


@dataclass(frozen=True, slots=True)
class CommandResult:
    success: bool


class CommandRunner(Protocol):
    def run(self, command: tuple[str, ...]) -> CommandResult: ...


@final
class SubprocessRunner:
    def run(self, command: tuple[str, ...]) -> CommandResult:
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        return CommandResult(success=completed.returncode == 0)


@final
class CacheWorker:
    def __init__(self, runner: CommandRunner, media_dir: Path) -> None:
        self._runner = runner
        self._media_dir = media_dir

    def cache(self, episode: Episode) -> EpisodeStatus:
        final_path = self._media_dir / "xuanan" / f"episode{episode.number.value}.mp4"
        partial_path = final_path.with_suffix(".mp4.part")
        final_path.parent.mkdir(parents=True, exist_ok=True)
        for source_url in (episode.primary_url, episode.fallback_url):
            partial_path.unlink(missing_ok=True)
            copied = self._runner.run(self._ffmpeg_command(source_url, partial_path)).success
            verified = copied and self._runner.run(self._ffprobe_command(partial_path)).success
            if verified:
                _ = partial_path.replace(final_path)
                return EpisodeStatus.READY
        partial_path.unlink(missing_ok=True)
        return EpisodeStatus.FAILED

    def _ffmpeg_command(self, source_url: str, partial_path: Path) -> tuple[str, ...]:
        return (
            "ffmpeg",
            "-nostdin",
            "-y",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-rw_timeout",
            "15000000",
            "-i",
            source_url,
            "-map",
            "0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(partial_path),
        )

    def _ffprobe_command(self, partial_path: Path) -> tuple[str, ...]:
        return (
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nokey=1:noprint_wrappers=1",
            str(partial_path),
        )
