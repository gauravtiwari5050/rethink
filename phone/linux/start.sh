#!/bin/sh
# Run from the computer after setup.sh, and again after each phone reboot or code change (needs adb root).
# Builds and pushes the phone-side code, then starts everything on the phone. Nothing runs on the computer:
# once this finishes you can unplug USB.
#   - MCP server (mcp/), call answering (probe/ CallBridge) and the call bridge (bridge/, runs in Debian)
#   - bridge/.env is copied to the phone the first time only (it holds the voice API key; never committed)
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
R=/data/local/rethink/debian
../../mcp/build.sh >/dev/null
../../probe/build.sh >/dev/null
$A root >/dev/null; $A wait-for-device
$A reverse --remove-all 2>/dev/null || true   # an old laptop-bridge `adb reverse` would take port 7070 on the phone
$A shell 'mkdir -p /data/local/tmp/rethink'
$A push ../../mcp/out/mcp.dex ../../probe/out/probe.dex /data/local/tmp/rethink/ >/dev/null
$A push boot.sh /data/local/rethink/boot.sh >/dev/null

# the call bridge, into Debian
$A push ../../bridge/server.js ../../bridge/blinkit.js ../../bridge/package.json ../../bridge/package-lock.json \
  $R/opt/rethink/bridge/ >/dev/null
if ! $A shell "[ -f $R/opt/rethink/bridge/.env ]"; then
  [ -f ../../bridge/.env ] || { echo "bridge/.env is missing (needs OPENAI_API_KEY)" >&2; exit 1; }
  $A push ../../bridge/.env $R/opt/rethink/bridge/.env >/dev/null
  echo "copied bridge/.env to the phone"
fi
$A shell "sh /data/local/rethink/boot.sh mount; chroot $R /usr/bin/env -i PATH=/usr/bin:/bin sh -c \
  'chown -R rethink:rethink /opt/rethink/bridge && chmod 600 /opt/rethink/bridge/.env && \
   su rethink -c \"cd /opt/rethink/bridge && npm ci --omit=dev --no-audit --no-fund >/dev/null\"'"

# restart what changed
$A shell "pkill -f [a]pp.rethink.mcp.Server; pkill -f [a]pp.rethink.probe.CallBridge; pkill -f '[n]ode server.js'" || true
$A shell 'sh /data/local/rethink/boot.sh start'
echo
echo "SSH: ssh -i ~/.ssh/rethink_phone -p 2222 rethink@<the phone's Wi-Fi address above>"
echo "Call log: ssh ... tail -f /opt/rethink/bridge/bridge.log"
