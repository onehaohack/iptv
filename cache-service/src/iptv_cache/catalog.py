from __future__ import annotations

from dataclasses import dataclass

from iptv_cache.models import EpisodeNumber


@dataclass(frozen=True, slots=True)
class Episode:
    number: EpisodeNumber
    primary_url: str
    fallback_url: str


@dataclass(frozen=True, slots=True)
class Catalog:
    episodes: tuple[Episode, ...]

    def next_episode(self, episode: EpisodeNumber) -> EpisodeNumber | None:
        for index, entry in enumerate(self.episodes):
            if entry.number == episode:
                return self.episodes[index + 1].number if index + 1 < len(self.episodes) else None
        return None
