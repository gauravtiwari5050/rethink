#!/bin/sh
# Builds out/mcp.dex from src/ with the Android SDK (javac + d8). No other dependencies.
set -e
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
JAR=$SDK/platforms/android-35/android.jar
BT=$SDK/build-tools/35.0.0
rm -rf build && mkdir -p build/classes out
javac -source 11 -target 11 -nowarn -Xlint:-options -encoding UTF-8 -cp "$JAR" -d build/classes $(find src -name '*.java')
"$BT/d8" --min-api 33 --lib "$JAR" --output build $(find build/classes -name '*.class')
mv build/classes.dex out/mcp.dex
shasum -a 256 out/mcp.dex
