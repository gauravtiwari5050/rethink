#!/bin/sh
# Run from the computer after setup.sh, and again after each phone reboot (needs adb root).
# Builds and pushes the MCP server, then starts the SSH server and the MCP server on the phone.
# Both keep running after you unplug USB.
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
../../mcp/build.sh >/dev/null
$A root >/dev/null; $A wait-for-device
$A shell 'mkdir -p /data/local/tmp/rethink'
$A push ../../mcp/out/mcp.dex /data/local/tmp/rethink/mcp.dex >/dev/null
$A push boot.sh /data/local/rethink/boot.sh >/dev/null
$A shell "pkill -f [a]pp.rethink.mcp.Server" || true   # pick up the freshly built server
$A shell 'sh /data/local/rethink/boot.sh start'
echo
echo "Connect with: ssh -i ~/.ssh/rethink_phone -p 2222 rethink@<the phone's Wi-Fi address above>"
