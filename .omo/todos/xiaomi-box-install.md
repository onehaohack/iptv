# Xiaomi Box Install TODO

Date: 2026-07-03

## Current State

- APK has been built successfully:
  `tvbox/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA256:
  `d4082a86938988cf3970681de9119a0b988e20a0b9fb1c29a8b494220c67ceea`
- Local build tools are installed under the user home:
  - JDK 17: `~/.local/opt/jdk-17`
  - Android SDK: `~/.local/share/android-sdk`
  - Gradle: `~/.local/opt/gradle-8.10.2`
  - `java`, `javac`, `gradle`, `adb`, `sdkmanager` symlinked in `~/.local/bin`
- Last checked `adb devices -l`: no device connected.
- 2026-07-03 follow-up:
  - This computer is on `192.168.1.9/24`.
  - `adb mdns services` discovered no Android debugging services.
  - `192.168.1.4` was reachable but refused TCP `5555`.
  - A quick scan of `192.168.1.2-254:5555` found no open ADB-over-network port.
- 2026-07-03 Xiaomi Box IP provided by user:
  - `192.168.1.6` is reachable on LAN.
  - TCP `5555` refused connections.
  - `adb connect 192.168.1.6:5555` returned `Connection refused`.
  - Install is blocked until Xiaomi Box ADB/network debugging is actually listening.
- 2026-07-03 install completed:
  - After enabling developer mode and allowing ADB authorization, `adb devices -l` showed `192.168.1.6:5555 device product:transformers model:MiBOX4 device:transformers`.
  - Device model: `MiBOX4`; Android version: `6.0.1`.
  - Installed `tvbox/app/build/outputs/apk/debug/app-debug.apk` successfully with `adb install -r`.
  - Launched `org.onehao.iptvbox`; foreground activity confirmed as `org.onehao.iptvbox/.MainActivity`.
  - Remote D-pad/OK events moved focus and selected channels.
  - CGTN playback displayed video successfully.
  - QTV streams returned `ERROR_CODE_PARSING_CONTAINER_MALFORMED`, but the app did not crash and could switch back to a working CGTN stream.
- 2026-07-03 all-sources build installed:
  - Added a TV Box export that reads every `streams/*.m3u` file instead of only China public streams.
  - Generated `tvbox/app/src/main/assets/channels_all.m3u` with `16668` streams.
  - App now loads `channels_all.m3u`.
  - Channel ordering prioritizes titles marked `(1080p)` first.
  - Installed rebuilt APK on `MiBOX4`.
  - Launch verified on Xiaomi Box; first screen shows 1080p channels.
  - Some full-library sources return HTTP/parse playback errors, but the app stays open and selectable.
- 2026-07-03 curated BBC/CNN/China build installed:
  - Replaced full-library TV Box export with a focused list:
    - English BBC/CNN channels.
    - China channels from `cn*.m3u` and channels whose `tvg-id` is under `.cn`.
  - Kept 1080p-first ordering.
  - Generated `tvbox/app/src/main/assets/channels_all.m3u` with `770` streams, including `246` marked `(1080p)`.
  - Confirmed `辽宁卫视` is present with 9 entries: 5 at 1080p, 1 at 720p, and 3 at 576p.
  - Searched external Liaoning IPTV sources and found `pro0x400gg/IPTV`, but its `辽宁卫视` URL returned HTTP 502 from this network, so it was not added.
  - Installed rebuilt APK on `MiBOX4` and launched successfully; foreground activity confirmed as `org.onehao.iptvbox/.MainActivity`.
- 2026-07-03 playback issue investigation:
  - User reported `江苏卫视` and `浙江卫视` respond slowly.
  - Runtime evidence points to source/network behavior rather than app logic:
    - App playback path is minimal: `MediaItem.fromUri(url)` -> `player.prepare()` -> `playWhenReady = true`.
    - Direct `curl --noproxy '*'` tests against several Jiangsu/Zhejiang URLs timed out at 5-8 seconds before first byte or returned server-side errors.
    - Example Jiangsu first sources timed out with `code=000`, `start=0.000000`, `total=5-8s`; one returned `code=500`, `start=1.086879`.
  - User also reported some BBC channels crash/flash back.
  - BBC risk findings:
    - MiBOX4 is Android `6.0.1`.
    - BBC list contained many `(HEVC)` and `[Geo-blocked]` sources.
    - Logcat during BBC playback showed Amlogic hardware decoder activity (`OMX.amlogic.avc.decoder.awesome`); no Java `FATAL EXCEPTION` was captured in the repro window.
    - Conservative mitigation added: BBC/CNN export now excludes `(HEVC)` and `[Geo-blocked]` titles.
  - After mitigation, generated `channels_all.m3u` has `638` streams and `191` marked `(1080p)`.
  - `npm test -- --runTestsByPath tests/commands/playlist/exportTvboxAll.test.ts tests/commands/playlist/exportChinaPublic.test.ts` passed.
  - `npx eslint scripts/commands/playlist/exportTvboxAll.ts tests/commands/playlist/exportTvboxAll.test.ts` passed.
  - `cd tvbox && ./gradlew :app:assembleDebug` passed.
  - Installed the HEVC/Geo-blocked-filtered APK to MiBOX4 with `adb install -r`.
  - Relaunched app; foreground activity confirmed as `org.onehao.iptvbox/.MainActivity`.
  - No `AndroidRuntime`, `FATAL EXCEPTION`, or `Fatal signal` was seen in the immediate launch log window.
  - Remaining manual QA: try several BBC channels from the filtered list on the TV remote.

## Resume Steps

1. On Xiaomi Box, enable developer options.
2. Enable `ADB debugging` or `Network debugging`.
3. Make sure Xiaomi Box and this computer are on the same LAN.
4. Get the Xiaomi Box IP address.
5. Connect and install:

```bash
adb connect <xiaomi-box-ip>:5555
adb install -r tvbox/app/build/outputs/apk/debug/app-debug.apk
```

For USB install, plug in the box and run:

```bash
adb devices -l
adb install -r tvbox/app/build/outputs/apk/debug/app-debug.apk
```

## Manual QA After Install

- [x] Launch `Onehao IPTV Box` from Xiaomi Box launcher / ADB.
- [x] Confirm remote D-pad can move through the channel list.
- [x] Press OK on several channels and confirm playback starts for working streams.
- [ ] Watch at least 3 channels for about 60 seconds each.
- [x] Confirm playback failure does not crash the app and another channel can be selected.
