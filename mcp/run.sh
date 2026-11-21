#!/bin/sh
# Build, push and run the Rethink Phone MCP server on a USB-connected phone (needs adb root).
# The server listens on the phone's localhost; adb forward exposes it to this computer at
# http://127.0.0.1:${MCP_PORT:-7071}/mcp. Ctrl-C stops it. Every tool call is printed here.
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
PORT=${MCP_PORT:-7071}
./build.sh
$A root >/dev/null; $A wait-for-device
$A shell 'mkdir -p /data/local/tmp/rethink'
$A push out/mcp.dex /data/local/tmp/rethink/mcp.dex >/dev/null
$A forward tcp:$PORT tcp:$PORT
$A shell "pkill -f [a]pp.rethink.mcp.Server" || true
exec $A shell "app_process -Djava.class.path=/data/local/tmp/rethink/mcp.dex /system/bin app.rethink.mcp.Server $PORT 127.0.0.1"
