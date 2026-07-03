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

- Launch `Onehao IPTV Box` from Xiaomi Box launcher.
- Confirm remote D-pad can move through the channel list.
- Press OK on several channels and confirm playback starts.
- Watch at least 3 channels for about 60 seconds each.
- Confirm playback failure does not crash the app and another channel can be selected.
