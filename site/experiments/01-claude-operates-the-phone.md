---
title: Claude operates the phone
date: 2026-11-22
status: Working
summary: An MCP server runs on the phone itself. Claude finds a contact, places a real call and sends a text, and every step lands in an audit log you can check.
draft: true
---

## What it does

You ask Claude, in plain words, to do something on the phone, and it does it on the real handset. In our first run:

> Call *[contact]*. … Hang up. … Text her: "Hi! This message was sent by Claude controlling my phone."

Claude looked up the contact, placed the call, hung up, opened Messages with the text filled in, read the screen to find the Send button and tapped it. The phone is a OnePlus Nord CE 3 Lite running LineageOS 24, on Airtel. Nobody touched the screen.

## Try it

You need a phone where `adb root` works, such as a LineageOS build with rooted debugging enabled.

```sh
git clone https://github.com/gauravtiwari5050/rethink
cd rethink
./mcp/run.sh      # builds, pushes and starts the server; leave it running
claude            # in another terminal, from the repo root; approve "rethink-phone"
```

Then ask it to call someone in your contacts.

## How it works

The phone runs a small [MCP](https://modelcontextprotocol.io) server: two Java files, no dependencies beyond the Android SDK, started as root with `app_process`. Any MCP client can connect to it. We used Claude Code.

Each tool wraps a standard Android command, so you can check anything it does by hand with `adb shell`:

| Tool | Android command underneath |
|---|---|
| `get_screen` | `uiautomator dump` (and `screencap` when asked) |
| `tap_element`, `tap`, `swipe` | `input tap`, `input swipe` |
| `type_text`, `press_key` | `input text`, `input keyevent` |
| `open_app`, `list_apps` | `monkey -p`, `cmd package query-activities` |
| `find_contact` | `content query` on the contacts provider |
| `place_call`, `end_call` | `am start -a android.intent.action.CALL`, `KEYCODE_ENDCALL` |
| `compose_sms` | `am start -a android.intent.action.SENDTO` |

## Safety

- **Nothing is sent without a visible tap.** `compose_sms` only opens Messages with the text filled in. To send, the agent has to read the screen and tap the phone's own Send button.
- **The client asks first.** Claude Code asks permission before each tool call.
- **Everything is logged.** Each call is printed live and appended to `/data/local/tmp/rethink/mcp-audit.jsonl` on the phone, with a timestamp, arguments and duration.
- **No network exposure.** The server listens on the phone's localhost only, and the laptop reaches it over USB.

## Limits

- Reading the screen takes about 2.5 seconds, because `uiautomator dump` is slow.
- Typing is ASCII only for now.
- It needs root.
