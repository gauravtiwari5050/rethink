---
title: Claude operates the phone
date: 2026-11-22
status: Working
summary: I put a small MCP server on the phone and asked Claude, in plain words, to read the screen, call someone and hang up. It did all three on the real handset, and every step is in the phone's audit log.
---

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

## What I wanted to try

Can Claude run my real phone from plain words, without me touching it?

The phone is a OnePlus Nord CE 3 Lite running LineageOS 24, on Airtel. I asked Claude to tell me what was on the screen, call someone and hang up. It did all three.

<video controls preload="metadata" playsinline poster="/assets/experiments/01/poster.jpg" src="/assets/experiments/01/claude-calls.mp4" width="1920" height="1080" style="width:100%;height:auto"></video>

This is a placeholder take. I'll replace it with a cleaner recording that also sends a text.

## What you're watching

On the left, Claude Code on my laptop. On the right, the phone's screen, mirrored with [scrcpy](https://github.com/Genymobile/scrcpy). I typed three prompts live:

1. `Can you tell me what is on my phones screen right now ?` Claude reads the home screen and describes it.
2. `can you call <number>` Claude places the call, then reads the screen to check the dialer says "Calling…".
3. `please end the call` Claude hangs up and checks that the phone is back on the home screen.

| | |
|---|---|
| Model | Claude Opus 5.5, in Claude Code v2.1.330 |
| Permissions | I had auto mode on, so Claude Code didn't ask before each tool call |
| Takes | Before this take, I placed the same call twice while setting up the recording |
| Edits | The phone number is covered with grey boxes in five places. Re-encoded at 30 fps for the web. No cuts, no speed changes |
| Audit log | [audit.jsonl](/assets/experiments/01/audit.jsonl), the phone's own record of every tool call, number redacted |

## Sending a text

Texting works too, but it isn't in this recording. Earlier the same day, Claude opened Messages with `compose_sms`, read the screen, found the Send button and tapped it. Those four entries are at the top of the same [audit log](/assets/experiments/01/audit.jsonl):

```
03:41:53  compose_sms   opened a new SMS … with the text filled in; not sent yet
03:41:57  get_screen    … [3] "Send Message" <button>
03:41:59  tap_element   tapped element 3 at 978,2199
03:42:04  get_screen    "You said, Hello, Now"
```

## Reproduce it

Step by step, from a fresh phone: [Reproduce Experiment 01](/experiments/claude-operates-the-phone/reproduce/). It starts from [Set up your phone](/setup/).

## How it works

The phone runs a small [MCP](https://modelcontextprotocol.io) server: two Java files, no dependencies beyond the Android SDK, started as root with `app_process`. Any MCP client can connect to it. I used Claude Code.

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

## What stops it from going wrong

- **Nothing is sent without a visible tap.** `compose_sms` only opens Messages with the text filled in. To send it, Claude has to read the screen and tap the phone's own Send button.
- **Claude Code can ask first.** It asks permission before each tool call unless you turn on auto mode, which I did for this recording.
- **Everything is logged.** Each call is printed live and appended to `/data/local/tmp/rethink/mcp-audit.jsonl` on the phone, with a timestamp, arguments and duration.
- **Nothing is exposed to the network.** The server listens only on the phone's localhost, and the laptop reaches it over USB.

## What it can't do yet

- Reading the screen takes about 2.5 seconds, because `uiautomator dump` is slow.
- Typing is ASCII only for now.
- It needs root.
