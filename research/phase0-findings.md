# Phase 0 findings — OnePlus Nord CE 3 Lite 5G (2026-11-18)

## Device (read via adb, stock OxygenOS)
| Property | Value |
|---|---|
| Model / codename | CPH2467 / `larry` (OP5958L1), SoC SM6375 (`holi`) |
| Build | CPH2467_15.0.0.1800(EX01), Android 15, patch 2026-03-01 |
| Bootloader | locked (`ro.boot.flash.locked=1`, verified boot green) |
| OEM unlock allowed | yes (`sys.oem_unlock_allowed=1`) |
| Carrier | Airtel, currently on IWLAN (Wi-Fi Calling active) |

## LineageOS
- Official, maintained (Vivekachooz), current branch **24.0**; device tree last updated 2026-10-30 from CPH2467_15.0.0.2000 firmware.
- Prereq: Android 14/15 firmware → satisfied.
- Install: `fastboot flashing unlock`; flash boot, dtbo, vbmeta, vendor_boot (recovery); A/B device, copy partitions step.
- Audio HAL is source-built (`hardware/qcom-caf/sm8350/audio`, `audio.primary.holi`); audio policy XML comes from vendor.

## Call-audio feasibility — POSITIVE (pending live test)
`/vendor/etc/audio/sku_holi/audio_policy_configuration.xml` declares:
- `AUDIO_DEVICE_OUT_TELEPHONY_TX` ("Telephony Tx") ← routes from `voice_tx` and `incall_music_uplink` (`AUDIO_OUTPUT_FLAG_INCALL_MUSIC`)  → **inject audio into call uplink**
- `AUDIO_DEVICE_IN_TELEPHONY_RX` ("Telephony Rx") → `voice_rx` mixPort → **capture caller (downlink) audio**

`dumpsys media.audio_policy` lists both as available/attached devices on the live system,
which is what `AudioManager.isPstnCallAudioInterceptable()` depends on.

Remaining unknown: whether the HAL actually streams PCM on these paths during a live VoLTE call.
Requires a privileged app holding `CALL_AUDIO_INTERCEPTION` → test after flashing LineageOS.

Raw dumps: `research/device-dump/`

## Live result on LineageOS 24.0 (Android 17), 2026-11-18 — ✅ WORKS
Flashed official `lineage-24.0-20261114-nightly-larry` (slot b). Airtel VoLTE call shows `prop=[HD]` + video caps (IMS); Wi-Fi Calling registered.

Probe (`probe/`, run via `app_process` as root, no APK) during a live iPhone → Nord call:
```
isPstnCallAudioInterceptable=true
capture path=api:getCallDownlinkExtractionAudioRecord
inject path=api:getCallUplinkInjectionAudioTrack
playing routedTo=18 (TYPE_TELEPHONY)
injected bytes=223746            (7 s TTS phrase, 16 kHz mono)
recorded bytes=480000 peak=29384 (15 s caller speech, RMS ~6–9k)
```
Both official Android 13+ SystemAPIs work out of the box — no audio HAL patch, no custom ROM build needed.
The production app needs only: priv-app + `CALL_AUDIO_INTERCEPTION` (privapp-permissions allowlist), or root/system uid.
