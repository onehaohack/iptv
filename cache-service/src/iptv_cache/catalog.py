from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from iptv_cache.models import EpisodeNumber


class UnknownEpisodeError(ValueError):
    def __init__(self, episode: EpisodeNumber) -> None:
        super().__init__(f"Episode is not allowlisted: {episode.value}")


@dataclass(frozen=True, slots=True)
class Episode:
    number: EpisodeNumber
    primary_url: str
    fallback_url: str


@dataclass(frozen=True, slots=True)
class Catalog:
    episodes: tuple[Episode, ...]

    @classmethod
    def from_tsv(cls, path: Path) -> Catalog:
        episodes: list[Episode] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            number, _, primary_url, fallback_url = line.split("|", maxsplit=3)
            episodes.append(Episode(EpisodeNumber(number), primary_url, fallback_url))
        return cls(tuple(episodes))

    def contains(self, episode: EpisodeNumber) -> bool:
        return any(entry.number == episode for entry in self.episodes)

    def require(self, episode: EpisodeNumber) -> Episode:
        for entry in self.episodes:
            if entry.number == episode:
                return entry
        raise UnknownEpisodeError(episode)

    def next_episode(self, episode: EpisodeNumber) -> EpisodeNumber | None:
        for index, entry in enumerate(self.episodes):
            if entry.number == episode:
                return self.episodes[index + 1].number if index + 1 < len(self.episodes) else None
        return None
