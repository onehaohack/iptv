# Onehao IPTV Box

Android TV sideload app for a small curated set of official/public China IPTV streams.

## Source Policy

The bundled playlist is generated from:

- `streams/cn.m3u`
- `streams/cn_cctv.m3u`
- `streams/cn_cgtn.m3u`

The generator only keeps selected official or broadcaster-owned public HLS hosts and excludes third-party aggregation sources such as `112114`/Douyu proxy lists. The output is:

```text
tvbox/app/src/main/assets/channels_cn_public.m3u
```

Regenerate it with:

```bash
npx tsx scripts/commands/playlist/exportChinaPublic.ts
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
