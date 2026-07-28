from __future__ import annotations

from typing import final

from iptv_cache.catalog import Catalog
from iptv_cache.models import EpisodeNumber, EpisodeState, EpisodeStatus, TriggerResult


@final
class EpisodeQueue:
    def __init__(self, catalog: Catalog) -> None:
        self._catalog = catalog
        self._states: dict[EpisodeNumber, EpisodeStatus] = {}
        self._high_priority: list[EpisodeNumber] = []
        self._prefetch: list[EpisodeNumber] = []

    def trigger(self, episode: EpisodeNumber) -> TriggerResult:
        current = self._schedule(episode, self._high_priority)
        next_episode = self._catalog.next_episode(episode)
        prefetch = (
            self._schedule(next_episode, self._prefetch)
            if next_episode is not None
            else None
        )
        return TriggerResult(current=current, prefetch=prefetch)

    def next_episode(self) -> EpisodeNumber | None:
        if self._high_priority:
            return self._high_priority[0]
        return self._prefetch[0] if self._prefetch else None

    def pending_episodes(self) -> tuple[EpisodeNumber, ...]:
        return tuple(self._high_priority + self._prefetch)

    def _schedule(self, episode: EpisodeNumber, priority: list[EpisodeNumber]) -> EpisodeState:
        status = self._states.get(episode)
        if status is None or status is EpisodeStatus.FAILED:
            self._states[episode] = EpisodeStatus.QUEUED
            if episode not in self._high_priority and episode not in self._prefetch:
                priority.append(episode)
            status = EpisodeStatus.QUEUED
        return EpisodeState(episode=episode, status=status)
