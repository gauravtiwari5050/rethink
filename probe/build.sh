#!/bin/sh
# Builds probe.dex and the test phrase (16 kHz mono s16le) for the call-audio probe.
set -e
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
JAR=$SDK/platforms/android-35/android.jar
BT=$SDK/build-tools/35.0.0
rm -rf build && mkdir -p build/classes out
javac -source 11 -target 11 -nowarn -Xlint:-options -cp "$JAR" -d build/classes $(find src -name '*.java')
"$BT/d8" --min-api 33 --lib "$JAR" --output build $(find build/classes -name '*.class')
mv build/classes.dex out/probe.dex
# The test phrase is only for `run-probe.sh test` and uses macOS text-to-speech; skipped elsewhere.
if command -v say >/dev/null && command -v afconvert >/dev/null; then
  say -o build/phrase.aiff "Hello! This is Rethink Phone speaking from inside the call. If you can hear this, call audio injection works."
  afconvert -f WAVE -d LEI16@16000 -c 1 build/phrase.aiff build/phrase.wav
  python3 -I -c "import wave,sys; w=wave.open(sys.argv[1]); open(sys.argv[2],'wb').write(w.readframes(w.getnframes()))" build/phrase.wav out/phrase.pcm
fi
ls -la out
