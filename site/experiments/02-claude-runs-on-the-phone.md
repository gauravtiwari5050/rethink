---
title: Claude runs on the phone, with root
date: 2026-11-22
status: Working
summary: I installed Claude Code inside a small Linux system on the phone itself and gave it root. When I asked it to call Gaurav, it looked up the contact and placed the call with Android's own commands.
---

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

## What I wanted to try

In [Experiment 01](/experiments/claude-operates-the-phone/), Claude ran on my laptop and reached the phone over USB. I wanted the agent itself on the phone. So I put a small Debian Linux system inside the phone, installed Claude Code there, and opened it from a terminal app on the phone's own screen.

I also gave it root. Instead of a fixed set of tools, Claude runs Android's own commands: `content query` to read contacts, `am start` to place a call, `input tap` to touch the screen.

<video controls preload="metadata" playsinline poster="/assets/experiments/02/poster.jpg" src="/assets/experiments/02/claude-on-the-phone.mp4" width="440" height="960" style="width:100%;max-width:360px;height:auto;margin-inline:auto"></video>

## What you're watching

The phone's screen, mirrored to my laptop with [scrcpy](https://github.com/Genymobile/scrcpy) for recording.

1. I open the terminal app ([Termux](https://github.com/termux/termux-app)). `debian` logs in to the phone's Debian, and `claude` starts Claude Code there. The header shows it's running in `/home/rethink`, on the phone.
2. I type `Can you call Gaurav`. Claude searches the phone's contacts, finds the number and places the call. The dialer comes up, then Claude tells me the call has started.

These are the two commands it ran, from the phone's own log:

```
16:18:10  content query --uri content://com.android.contacts/data/phones --projection display_name:data1
16:18:16  am start -a android.intent.action.CALL -d tel:+91XXXXXXXXXX
```

| | |
|---|---|
| Model | Claude Opus 5.5, in Claude Code v2.1.330, running on the phone |
| Permissions | I had auto mode on, so Claude Code ran both commands without asking |
| Typing | I typed on my laptop's keyboard through scrcpy, which forwards keystrokes to the phone. Claude, its tools and the call all ran on the phone |
| Takes | One earlier run at 15:17, the first time it worked, which also placed and ended a call. Before that, calls failed (see below) |
| Ending | The call ended on its own after about 8 seconds. Claude didn't hang up, and the take stops with "hang up" typed but not sent |
| Edits | Cropped to the phone. The number is covered in the dialer and in Claude's replies, and the transcript is covered for 6 seconds while the command with the number scrolled by. Re-encoded at 30 fps. No cuts, no speed changes |
| Log | [android-commands.log](/assets/experiments/02/android-commands.log), number redacted |

## How it works

- **Debian 13 (arm64)** is unpacked into `/data/local/rethink/debian` and entered with `chroot`. It's the root filesystem of Docker's official `debian:trixie-slim` image, pinned by commit and checksum.
- **Claude Code** is the official Linux arm64 build, installed as an ordinary user, `rethink`.
- **Root** is a single command, `sudo android <command>`, which runs the command in Android's real root shell. It gets there through `/proc/1/root`, the root filesystem of Android's first process. Every call is appended to a log.
- **A `CLAUDE.md`** file tells Claude it's on the phone, lists the useful commands, and asks it to say what it's about to do before calling or messaging anyone.
- **Termux** is the terminal. It's an ordinary app without root, so it logs in to Debian over SSH on `127.0.0.1`. I can also SSH in from my laptop on the same Wi-Fi.

The whole setup is three scripts in [`phone/linux/`](https://github.com/gauravtiwari5050/rethink/tree/main/phone/linux).

## What went wrong first

Claude's first attempts to call failed with `Failed transaction`. The kernel's SELinux log showed why. Claude Code saves each command's output to a file. `am` passes that file to Android's system service, and SELinux won't let the service write into Debian's files. My tests over SSH used pipes instead of files, so they passed. The fix: `android` now always passes output through a pipe.

## Root versus the MCP server

Experiment 01 gave Claude 13 named tools through an MCP server. This one gives it root.

- **What root adds:** anything Android can do, with no tool to write first.
- **What it costs:** no limits. Claude could read every app's data or wipe the phone. What's left is Claude Code's permission prompt, which shows each exact command, plus `CLAUDE.md` and the log. With auto mode on, as in this take, only the last two apply.

I'm keeping both for now, and I'll write up which one I keep and why.

## Reproduce it

Step by step, from a fresh phone: [Reproduce Experiment 02](/experiments/claude-runs-on-the-phone/reproduce/). It starts from [Set up your phone](/setup/).

## What it can't do yet

- After a reboot, it needs `start.sh` over USB again.
- The model still runs in Anthropic's cloud. The phone runs the agent, its tools and its log.
- Termux's OpenSSH comes from its rolling package repository, so that piece isn't pinned.
