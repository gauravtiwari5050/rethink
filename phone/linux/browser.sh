#!/bin/sh
# Once, after setup.sh: installs Chromium on the phone (an official Chromium build, pinned and checksummed),
# so Claude can browse on the phone's own screen. Run from the computer with the phone on USB (needs adb root).
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}

# Chromium's continuous Android arm64 build from Google's snapshot bucket, Chromium 160.0.8178.0.
CHROMIUM_REVISION=1751520
CHROMIUM_ZIP_SHA256=a40c085a7d7e5d837e936fb3ee9843200b29c56c78efcab9fc3d8e472dbb2f3d
CHROMIUM_APK_SHA256=33e1d0e82bf84f01b0a198323dd0a412a3b4ea09c3759571f8c45086492518fb
ZIP=.cache/chrome-android-$CHROMIUM_REVISION.zip
APK=.cache/chromium-$CHROMIUM_REVISION/ChromePublic.apk

mkdir -p .cache
if [ ! -f $APK ]; then
  [ -f $ZIP ] || { echo "downloading Chromium (441 MB)"; curl -fL --progress-bar -o $ZIP.part \
    "https://commondatastorage.googleapis.com/chromium-browser-snapshots/Android_Arm64/$CHROMIUM_REVISION/chrome-android.zip" && mv $ZIP.part $ZIP; }
  echo "$CHROMIUM_ZIP_SHA256  $ZIP" | shasum -a 256 -c -
  unzip -o -j -q $ZIP chrome-android/apks/ChromePublic.apk -d .cache/chromium-$CHROMIUM_REVISION
fi
echo "$CHROMIUM_APK_SHA256  $APK" | shasum -a 256 -c -

$A root >/dev/null; $A wait-for-device
$A install -r $APK
# Skip the first-run screens. Chromium reads this file on userdebug builds such as LineageOS.
$A shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line; chmod 644 /data/local/tmp/chrome-command-line'
echo "Done. Open Chromium on the phone once and log in to the sites Claude should use (e.g. blinkit.com)."
