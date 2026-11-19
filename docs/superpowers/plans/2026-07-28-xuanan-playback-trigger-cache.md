# 《悬案》播放触发缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a selected 《悬案》 episode queue server-side caching of itself and the next episode while the TV box keeps immediate fallback playback.

**Architecture:** A FastAPI service owns the fixed 17-episode catalog, a persistent priority queue, one FFmpeg worker, and completed MP4 delivery. The Android app calls its status and trigger endpoints with short timeouts and prepends a ready local URL without removing existing failover sources.

**Tech Stack:** Python 3.11, uv, FastAPI, Uvicorn, Pydantic v2, AnyIO, pytest; Kotlin/Android Media3; systemd user service.

---

### Task 1: Create the cache queue domain

**Files:**
- Create: `cache-service/pyproject.toml`
- Create: `cache-service/src/iptv_cache/models.py`
- Create: `cache-service/src/iptv_cache/catalog.py`
- Create: `cache-service/src/iptv_cache/queue.py`
- Create: `cache-service/tests/test_queue.py`

- [ ] **Step 1: Write the failing queue tests**

```python
def test_trigger_prioritizes_selected_episode_and_prefetches_next() -> None:
    queue = EpisodeQueue(Catalog.from_rows([row("01"), row("02")]))
    result = queue.trigger(EpisodeNumber("01"))
    assert result.current.status is EpisodeStatus.QUEUED
    assert result.prefetch.status is EpisodeStatus.QUEUED
    assert queue.next_episode() == EpisodeNumber("01")

def test_repeated_trigger_does_not_duplicate_an_episode() -> None:
    queue = EpisodeQueue(Catalog.from_rows([row("01"), row("02")]))
    queue.trigger(EpisodeNumber("01"))
    queue.trigger(EpisodeNumber("01"))
    assert queue.pending_episodes() == (EpisodeNumber("01"), EpisodeNumber("02"))
```

- [ ] **Step 2: Run the tests and observe the missing package**

Run: `cd cache-service && uv run pytest tests/test_queue.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'iptv_cache'`.

- [ ] **Step 3: Implement immutable queue values**

```python
class EpisodeStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    READY = "ready"
    FAILED = "failed"

@dataclass(frozen=True, slots=True)
class EpisodeNumber:
    value: str

    def __post_init__(self) -> None:
        if not re.fullmatch(r"(?:0[1-9]|1[0-7])", self.value):
            raise InvalidEpisodeNumber(self.value)
```

Implement `EpisodeQueue.trigger()` to insert the selected episode at high priority, then its valid successor at low priority unless that successor is already ready, queued, or downloading.

- [ ] **Step 4: Run the queue tests**

Run: `cd cache-service && uv run pytest tests/test_queue.py -q`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the queue layer**

```bash
git add cache-service/pyproject.toml cache-service/src/iptv_cache cache-service/tests/test_queue.py
git commit -m "Add episode cache queue"
```

### Task 2: Add the allowlisted HTTP API

**Files:**
- Create: `cache-service/src/iptv_cache/app.py`
- Create: `cache-service/src/iptv_cache/state.py`
- Create: `cache-service/tests/test_api.py`

- [ ] **Step 1: Write the failing API tests**

```python
def test_trigger_returns_selected_and_prefetch_episode(client: TestClient) -> None:
    response = client.post("/api/v1/xuanan/episodes/01/trigger")
    assert response.status_code == 202
    assert response.json()["current"]["episode"] == "01"
    assert response.json()["prefetch"]["episode"] == "02"

def test_ready_episode_exposes_lan_url_only(client: TestClient) -> None:
    client.app.state.queue.mark_ready(EpisodeNumber("01"))
    response = client.get("/api/v1/xuanan/episodes/01")
    assert response.json() == {
        "episode": "01",
        "status": "ready",
        "url": "http://192.168.1.5:8788/xuanan/episode01.mp4",
    }
```

- [ ] **Step 2: Run the tests and observe the absent application factory**

Run: `cd cache-service && uv run pytest tests/test_api.py -q`

Expected: FAIL with import error for `create_app`.

- [ ] **Step 3: Implement endpoint parsing and responses**

```python
@app.post("/api/v1/xuanan/episodes/{episode}/trigger", status_code=202)
def trigger(episode: str) -> TriggerResponse:
    return TriggerResponse.from_result(queue.trigger(EpisodeNumber(episode)))
```

Add `GET /healthz`, `GET /api/v1/xuanan/episodes/{episode}`, and a static mount at `/xuanan` rooted at completed media. Invalid episode input becomes HTTP 404 and never becomes a path or URL.

- [ ] **Step 4: Run the API tests**

Run: `cd cache-service && uv run pytest tests/test_api.py -q`

Expected: PASS with trigger, ready-state, health, and invalid-episode cases.

- [ ] **Step 5: Commit the HTTP API**

```bash
git add cache-service/src/iptv_cache/app.py cache-service/src/iptv_cache/state.py cache-service/tests/test_api.py
git commit -m "Add cache trigger API"
```

### Task 3: Add durable one-worker FFmpeg caching

**Files:**
- Create: `cache-service/src/iptv_cache/worker.py`
- Create: `cache-service/src/iptv_cache/main.py`
- Create: `cache-service/tests/test_worker.py`
- Modify: `cache-service/catalog/xuanan.tsv`

- [ ] **Step 1: Write the failing worker tests**

```python
def test_worker_uses_fallback_when_primary_fails(tmp_path: Path) -> None:
    runner = FakeRunner((ProcessFailure(), ProcessSuccess(duration="1200.0")))
    worker = CacheWorker(runner=runner, media_dir=tmp_path)
    assert worker.cache(row("01")).status is EpisodeStatus.READY
    assert runner.urls == (PRIMARY_URL, FALLBACK_URL)
    assert (tmp_path / "xuanan/episode01.mp4").is_file()

def test_worker_never_publishes_a_partial_file(tmp_path: Path) -> None:
    worker = CacheWorker(FakeRunner((ProcessFailure(), ProcessFailure())), tmp_path)
    assert worker.cache(row("01")).status is EpisodeStatus.FAILED
    assert not (tmp_path / "xuanan/episode01.mp4").exists()
```

- [ ] **Step 2: Run the worker tests and observe the missing worker**

Run: `cd cache-service && uv run pytest tests/test_worker.py -q`

Expected: FAIL with import error for `CacheWorker`.

- [ ] **Step 3: Implement source fallback and atomic publishing**

```python
command = (
    "ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "warning",
    "-rw_timeout", "15000000", "-i", source_url, "-map", "0", "-c", "copy",
    "-movflags", "+faststart", str(partial_path),
)
```

Run `ffprobe` after a successful FFmpeg copy, then atomically replace `episodeNN.mp4`. Store ready/failed state in `/vol2/iptv-cache/state.json`. Start exactly one AnyIO worker loop that drains high-priority work before prefetch work.

- [ ] **Step 4: Run the worker tests**

Run: `cd cache-service && uv run pytest tests/test_worker.py -q`

Expected: PASS with fallback and partial-file cases.

- [ ] **Step 5: Commit the worker**

```bash
git add cache-service/src/iptv_cache/worker.py cache-service/src/iptv_cache/main.py cache-service/tests/test_worker.py cache-service/catalog/xuanan.tsv
git commit -m "Add cache download worker"
```

### Task 4: Add non-blocking Android trigger and local-source priority

**Files:**
- Create: `tvbox/app/src/main/java/org/onehao/iptvbox/XuananCacheClient.kt`
- Create: `tvbox/app/src/main/java/org/onehao/iptvbox/XuananCacheSources.kt`
- Create: `tvbox/app/src/test/java/org/onehao/iptvbox/XuananCacheSourcesTest.kt`
- Modify: `tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt`
- Modify: `tvbox/app/build.gradle.kts`

- [ ] **Step 1: Write failing Kotlin source-order tests**

```kotlin
@Test
fun readyEpisodePrependsLanUrl() {
    assertEquals(
        listOf("http://192.168.1.5:8788/xuanan/episode01.mp4", "https://primary", "https://fallback"),
        cachePreferredSources(listOf("https://primary", "https://fallback"), "http://192.168.1.5:8788/xuanan/episode01.mp4"),
    )
}

@Test
fun unavailableEpisodeKeepsExistingSources() {
    assertEquals(listOf("https://primary", "https://fallback"), cachePreferredSources(listOf("https://primary", "https://fallback"), null))
}
```

- [ ] **Step 2: Run the Android test and observe the unresolved helper**

Run: `cd tvbox && ./gradlew :app:testDebugUnitTest --tests org.onehao.iptvbox.XuananCacheSourcesTest`

Expected: FAIL with unresolved reference `cachePreferredSources`.

- [ ] **Step 3: Implement source ordering and background client**

```kotlin
fun cachePreferredSources(existing: List<String>, readyUrl: String?): List<String> =
    readyUrl?.let { listOf(it) + existing.filterNot { source -> source == it } } ?: existing
```

Use a short-lived background executor. It gets episode status first, then posts a trigger; network failure returns the original source list. Resolve the local URL before `MediaItem` construction only; never replace an item after playback starts.

- [ ] **Step 4: Run the Android test**

Run: `cd tvbox && ./gradlew :app:testDebugUnitTest --tests org.onehao.iptvbox.XuananCacheSourcesTest`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit APK integration**

```bash
git add tvbox/app/src/main/java/org/onehao/iptvbox/XuananCacheClient.kt tvbox/app/src/main/java/org/onehao/iptvbox/XuananCacheSources.kt tvbox/app/src/test/java/org/onehao/iptvbox/XuananCacheSourcesTest.kt tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt tvbox/app/build.gradle.kts
git commit -m "Trigger episode caching from TV box"
```

### Task 5: Deploy and observe the real chain

**Files:**
- Modify: `cache-service/systemd/iptv-cache-http.service`
- Create: `cache-service/systemd/iptv-cache.service`
- Modify: `docs/iptv-cache-service-plan.md`

- [ ] **Step 1: Check deployment prerequisites**

Run: `ssh onehao@192.168.1.5 'test -d /vol2 && command -v ffmpeg && command -v ffprobe && loginctl show-user onehao -p Linger'`

Expected: both binaries and `Linger=yes`.

- [ ] **Step 2: Verify no pre-existing listener exists**

Run: `ssh onehao@192.168.1.5 'systemctl --user is-active iptv-cache.service || true; ss -ltn | grep ":8788" || true'`

Expected: inactive service and no listener.

- [ ] **Step 3: Install the service package**

```ini
[Service]
Environment=IPTV_CACHE_DATA_DIR=/vol2/iptv-cache
Environment=IPTV_CACHE_PUBLIC_BASE=http://192.168.1.5:8788
ExecStart=/home/onehao/.local/bin/uv run --directory /home/onehao/iptv-cache-service iptv-cache
Restart=on-failure
RestartSec=5
```

Install user-local `uv`, copy only the cache-service package to `/home/onehao/iptv-cache-service`, create `/vol2/iptv-cache`, install the user unit, then run `systemctl --user daemon-reload` and `enable --now iptv-cache.service`.

- [ ] **Step 4: Verify the live API and queue transition**

Run:

```bash
curl --fail http://192.168.1.5:8788/healthz
curl --fail -X POST http://192.168.1.5:8788/api/v1/xuanan/episodes/01/trigger
curl --fail http://192.168.1.5:8788/api/v1/xuanan/episodes/01
```

Expected: health response, a `202` response naming `01` and `02`, then `queued`, `downloading`, or `ready`.

- [ ] **Step 5: Build, install, and manually test the APK**

```bash
cd tvbox && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On the Xiaomi Box, choose an uncached episode and confirm immediate fallback playback while the service reports it queued/downloading. After it is ready, choose it again and confirm the selected source is `http://192.168.1.5:8788/xuanan/episodeNN.mp4`.

- [ ] **Step 6: Commit deployment artifacts**

```bash
git add cache-service/systemd docs/iptv-cache-service-plan.md
git commit -m "Deploy playback-triggered cache service"
```

