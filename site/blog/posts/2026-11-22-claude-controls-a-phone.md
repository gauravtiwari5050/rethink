---
title: Claude can now operate a real phone
date: 2026-11-22
summary: We put an MCP server on the phone itself. Claude called a contact and sent a text, and every step is in an audit log you can check.
author: Gaurav Tiwari
draft: true
---

Today an AI placed a phone call and sent a text message from a real phone: a OnePlus Nord CE 3 Lite running LineageOS 24, on the Airtel network. Nobody touched the screen. This post explains how it works and how to reproduce it.

## What we built

A small [MCP](https://modelcontextprotocol.io) server that runs **on the phone**, not on a laptop pretending to be one. It is two Java files with no dependencies beyond the Android SDK, started as root with `app_process`.

Any MCP client can connect to it. We used Claude Code. The server offers 13 tools:

| Tool | Android command underneath |
|---|---|
| `get_screen` | `uiautomator dump` (and `screencap` when asked) |
| `tap_element`, `tap`, `swipe` | `input tap`, `input swipe` |
| `type_text`, `press_key` | `input text`, `input keyevent` |
| `open_app`, `list_apps` | `monkey -p`, `cmd package query-activities` |
| `find_contact` | `content query` on the contacts provider |
| `place_call`, `end_call` | `am start -a android.intent.action.CALL`, `KEYCODE_ENDCALL` |
| `compose_sms` | `am start -a android.intent.action.SENDTO` |

Every tool is a thin wrapper around a standard command, so you can check anything it does by hand with `adb shell`.

## Safety, by design

- **Nothing is sent without a visible tap.** `compose_sms` only opens Messages with the text filled in. To send, the agent has to read the screen and tap the phone's own Send button.
- **The client asks first.** Claude Code asks permission before each tool call.
- **Everything is logged.** Each call is printed live and appended to `/data/local/tmp/rethink/mcp-audit.jsonl` on the phone, with a timestamp, arguments and duration.
- **No network exposure.** The server listens on the phone's localhost only, and the laptop reaches it over USB.

## Reproduce it

You need a phone where `adb root` works, such as a LineageOS build with rooted debugging enabled.

```sh
git clone https://github.com/gauravtiwari5050/rethink
cd rethink
./mcp/run.sh      # builds, pushes and starts the server; leave it running
claude            # in another terminal, from the repo root; approve "rethink-phone"
```

Then ask it to call someone in your contacts.

## Limits, stated plainly

- Reading the screen takes about 2.5 seconds, because `uiautomator dump` is slow.
- Typing is ASCII only for now.
- It needs root.

All three are next on the list.
