from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

EPISODE_NUMBER_PATTERN: Final = re.compile(r"(?:0[1-9]|1[0-7])")


class InvalidEpisodeNumberError(ValueError):
    def __init__(self, value: str) -> None:
        super().__init__(f"Invalid episode number: {value}")


@dataclass(frozen=True, slots=True)
class EpisodeNumber:
    value: str

    def __post_init__(self) -> None:
        if EPISODE_NUMBER_PATTERN.fullmatch(self.value) is None:
            raise InvalidEpisodeNumberError(self.value)


class EpisodeStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    READY = "ready"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class EpisodeState:
    episode: EpisodeNumber
    status: EpisodeStatus


@dataclass(frozen=True, slots=True)
class TriggerResult:
    current: EpisodeState
    prefetch: EpisodeState | None
