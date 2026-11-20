#!/bin/sh
# Build + push the phone-side CallBridge, set up adb reverse, and run it (Ctrl-C to stop).
set -e
cd "$(dirname "$0")/.."
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
./probe/build.sh >/dev/null
$A root >/dev/null; $A wait-for-device
$A shell 'mkdir -p /data/local/tmp/rethink && chmod 777 /data/local/tmp/rethink'
$A push probe/out/probe.dex /data/local/tmp/rethink/ >/dev/null
$A reverse tcp:${BRIDGE_PORT:-7070} tcp:${BRIDGE_PORT:-7070}
$A shell "pkill -f [a]pp.rethink.probe.CallBridge" || true
exec $A shell "app_process -Djava.class.path=/data/local/tmp/rethink/probe.dex /system/bin app.rethink.probe.CallBridge ${BRIDGE_PORT:-7070} ${ANSWER_DELAY_MS:-2000}"
