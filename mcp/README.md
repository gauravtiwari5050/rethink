# Rethink Phone MCP server

An [MCP](https://modelcontextprotocol.io) server that runs **on the phone itself** and lets an AI client
(Claude, or any MCP client) see and operate a real Android phone.

- One Java program, run as root with `app_process`. Its only dependencies are the Android SDK and the
  APIs Android ships, such as `org.json`.
- Every tool is a thin wrapper around a standard Android command (`input`, `am`, `uiautomator`, `screencap`,
  `content`), so you can check anything it does by hand with `adb shell`.
- Every tool call is printed live and appended to an audit log on the phone at
  `/data/local/tmp/rethink/mcp-audit.jsonl`.
- It listens on the phone's `127.0.0.1` only. Your computer reaches it over USB through `adb forward`.

## Tested on

| | |
|---|---|
| Phone | OnePlus Nord CE 3 Lite 5G (CPH2467, `larry`) |
| OS | LineageOS 24.0 (Android 17), adb root enabled |
| Computer | macOS, Android SDK platform 35 + build-tools 35.0.0, JDK 17+ |

It should work on any Android 13+ phone where `adb root` works, for example a LineageOS build with
root debugging enabled. It does not work on a stock, unrooted phone.

## Run it

1. On the phone, enable Developer options, then USB debugging and Rooted debugging, and plug it in.
2. Run `./mcp/run.sh`, which builds `out/mcp.dex`, pushes it, sets up `adb forward tcp:7071` and starts the server.
   Leave it running. Tool calls scroll by in this terminal.
3. Connect a client to `http://127.0.0.1:7071/mcp`:
   - **Claude Code:** the repo's `.mcp.json` already points there. Run `claude` from the repo root.
   - **Any other MCP client:** use the Streamable HTTP transport at the same URL.

Quick check without any AI:

```sh
curl -s http://127.0.0.1:7071/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"device_status","arguments":{}}}'
```

## Tools

| Tool | What it does | Android command underneath |
|---|---|---|
| `device_status` | Battery, network, screen state, foreground app, time | `dumpsys battery/power/activity`, `getprop` |
| `get_screen` | Numbered list of on-screen elements; optional screenshot | `uiautomator dump`, `screencap` |
| `tap_element`, `tap` | Tap an element from `get_screen`, or a point | `input tap` |
| `swipe` | Scroll up, down, left or right | `input swipe` |
| `type_text` | Type into the focused field (ASCII for now) | `input text` |
| `press_key` | Back, home, recents, enter, delete, wake | `input keyevent` |
| `list_apps`, `open_app` | Launchable apps; open one | `cmd package query-activities`, `monkey -p` |
| `find_contact` | Search contacts by name | `content query` on the contacts provider |
| `place_call`, `end_call` | Real call; hang up | `am start -a android.intent.action.CALL`, `KEYCODE_ENDCALL` |
| `compose_sms` | Open a pre-filled SMS. It does **not** send it. | `am start -a android.intent.action.SENDTO` |

Sending a message always takes a visible tap on the phone's own Send button, so a person watching the screen,
or the client's permission prompt, sees it happen.

## Limits, stated plainly

- `get_screen` takes about 2–3 s because `uiautomator dump` is slow. A faster UiAutomation-based reader is planned.
- `type_text` handles ASCII only for now.
- It needs root. A version that runs as an ordinary privileged app is future work.

## Verify the build

`build.sh` prints the SHA-256 of `out/mcp.dex`. Builds from the same source with the same SDK versions
should match.
