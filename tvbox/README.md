# Onehao IPTV Box

Android TV sideload app for a focused set of IPTV streams bundled in this repository.

## Source Policy

The bundled playlist is generated from `streams/*.m3u` files in this repository, filtered for:

- English BBC/CNN channels
- China channels, including Liaoning TV sources

The output is:

```text
tvbox/app/src/main/assets/channels_all.m3u
```

Regenerate it with:

```bash
npm run playlist:export:tvbox
```

## Build

This host currently needs a JDK 17 and Android SDK before the APK can be compiled. Once those are installed and `ANDROID_HOME` points at the SDK:

```bash
cd tvbox
./gradlew :app:assembleDebug
```

Debug APK path:

```text
tvbox/app/build/outputs/apk/debug/app-debug.apk
```

## Sideload

With USB debugging enabled on the TV box:

```bash
adb install -r tvbox/app/build/outputs/apk/debug/app-debug.apk
```

Manual smoke test:

- Launch `Onehao IPTV Box` from the TV launcher.
- Move focus through the channel list with the remote D-pad.
- Press OK on a channel and confirm playback starts.
- Switch to another channel after a playback error or timeout.
