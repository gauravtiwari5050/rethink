#!/bin/sh
# Usage: ./run-probe.sh check | ./run-probe.sh test [secs]
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
D=/data/local/tmp/rethink
if [ "$1" = "test" ]; then ARGS="test ${2:-15} $D/phrase.pcm $D"; else ARGS="check"; fi
$A shell "app_process -Djava.class.path=$D/probe.dex /system/bin app.rethink.probe.Probe $ARGS" 2>&1
