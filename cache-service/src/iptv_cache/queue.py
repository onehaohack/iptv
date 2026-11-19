from __future__ import annotations

from typing import final

from iptv_cache.catalog import Catalog, Episode, UnknownEpisodeError
from iptv_cache.models import EpisodeNumber, EpisodeState, EpisodeStatus, TriggerResult


@final
class EpisodeQueue:
    def __init__(self, catalog: Catalog) -> None:
        self._catalog = catalog
        self._states: dict[EpisodeNumber, EpisodeStatus] = {}
        self._high_priority: list[EpisodeNumber] = []
        self._prefetch: list[EpisodeNumber] = []

    def trigger(self, episode: EpisodeNumber) -> TriggerResult:
        if not self._catalog.contains(episode):
            raise UnknownEpisodeError(episode)
        current = self._schedule(episode, self._high_priority)
        next_episode = self._catalog.next_episode(episode)
        prefetch = (
            self._schedule(next_episode, self._prefetch) if next_episode is not None else None
        )
        return TriggerResult(current=current, prefetch=prefetch)

    def next_episode(self) -> EpisodeNumber | None:
        if self._high_priority:
            return self._high_priority[0]
        return self._prefetch[0] if self._prefetch else None

    def pending_episodes(self) -> tuple[EpisodeNumber, ...]:
        return tuple(self._high_priority + self._prefetch)

    def claim_next(self) -> EpisodeNumber | None:
        episode = self.next_episode()
        if episode is None:
            return None
        self._high_priority = [queued for queued in self._high_priority if queued != episode]
        self._prefetch = [queued for queued in self._prefetch if queued != episode]
        self._states[episode] = EpisodeStatus.DOWNLOADING
        return episode

    def status(self, episode: EpisodeNumber) -> EpisodeStatus | None:
        return self._states.get(episode)

    def episode(self, episode: EpisodeNumber) -> Episode:
        return self._catalog.require(episode)

    def mark_ready(self, episode: EpisodeNumber) -> None:
        if not self._catalog.contains(episode):
            raise UnknownEpisodeError(episode)
        self._states[episode] = EpisodeStatus.READY
        self._high_priority = [queued for queued in self._high_priority if queued != episode]
        self._prefetch = [queued for queued in self._prefetch if queued != episode]

    def mark_failed(self, episode: EpisodeNumber) -> None:
        self._states[episode] = EpisodeStatus.FAILED

    def _schedule(self, episode: EpisodeNumber, priority: list[EpisodeNumber]) -> EpisodeState:
        status = self._states.get(episode)
        if status is None or status is EpisodeStatus.FAILED:
            self._states[episode] = EpisodeStatus.QUEUED
            if episode not in self._high_priority and episode not in self._prefetch:
                priority.append(episode)
            status = EpisodeStatus.QUEUED
        return EpisodeState(episode=episode, status=status)
