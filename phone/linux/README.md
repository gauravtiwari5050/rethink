# Claude Code on the phone, with root

Runs a small Debian system on the phone, with an SSH server and Claude Code. You SSH into the phone, start
`claude`, and it operates the phone with root, through `sudo android <command>`, which runs any command in
Android's own root shell.
The model runs in Anthropic's cloud, as it does on a laptop. The agent, its tools and its log are on the phone.

## How it works

- **Debian 13 "trixie" (arm64)**, unpacked into `/data/local/rethink/debian` and entered with `chroot`. It's the root
  filesystem of Docker's official `debian:trixie-slim` image. `setup.sh` pins its commit and SHA-256.
- **OpenSSH** on port 2222, for one user, `rethink`. It accepts key logins only: no passwords and no root login.
- **Claude Code**, the official native Linux arm64 build, pinned in `setup.sh`.
- **`android`** (`/usr/local/bin/android`) enters Android's root filesystem through `/proc/1/root` with Android's
  environment, which `boot.sh` saves at start. So `input`, `am`, `uiautomator`, `screencap`, `content` and
  `dumpsys` all work. Each call is appended to `/var/log/android-commands.log` in Debian.
- **`~/CLAUDE.md`** tells Claude it's on the phone, lists the useful commands, and asks it to say what it's about
  to do before calling or messaging anyone. The MCP server isn't registered for this setup. To use it instead, see
  the end of `provision.sh`.
- `/data` is mounted `nosuid` on Android, so `boot.sh` re-mounts only the Debian tree with `suid`, which lets
  `sudo` work.
- Android only lets members of group 3003 open network sockets, so `rethink` is in that group, and apt downloads as root.
- DNS goes to 1.1.1.1 and 8.8.8.8, since Android has no `resolv.conf` to share.

## Tested on

| | |
|---|---|
| Phone | OnePlus Nord CE 3 Lite 5G (CPH2467), LineageOS 24.0, adb root enabled, SELinux enforcing |
| Debian | 13.7 slim, arm64, debuerreotype artifacts commit `5994ab6` |
| Claude Code | 2.1.330 |

## Run it

With the phone on USB and on the same Wi-Fi as your computer:

```sh
./phone/linux/setup.sh     # once: downloads and verifies Debian (28 MB), installs ssh + Claude Code (~3 min)
./phone/linux/start.sh     # after each reboot: starts the SSH and MCP servers; prints the phone's address
ssh -i ~/.ssh/rethink_phone -p 2222 rethink@<phone address>
claude                     # first time: sign in, then ask it to do something on the phone
```

`setup.sh` creates a dedicated key, `~/.ssh/rethink_phone`, unless you pass your own `.pub` file. Once `start.sh`
has run you can unplug USB. Both servers keep running until the phone reboots.

### A terminal on the phone itself

```sh
./phone/linux/termux.sh    # once, after setup.sh
```

This installs [Termux](https://github.com/termux/termux-app) (v0.118.3, the official GitHub build, checksummed),
gives it OpenSSH from Termux's package repository, and creates a key that never leaves the phone. It also adds a
`debian` command. Termux's OpenSSH comes from its rolling package repository, so that one piece isn't pinned. On the phone, open Termux, type `debian`, then `claude`. Termux runs as an ordinary app
without root, so it gets into Debian over SSH on `127.0.0.1:2222`, the same way your computer does.

### Stopping and removing

On the phone, `sh /data/local/rethink/boot.sh stop` stops both servers and unmounts. To remove everything, run that
and then `rm -rf /data/local/rethink`.

## Security, stated plainly

- **Claude has root on the phone.** It can do anything, including reading every app's data or wiping the phone.
  `chroot` is not a sandbox. Anyone with the SSH key, or with Termux on the phone, can do the same.
- What keeps this in check is Claude Code's permission prompt, which shows each exact command before it runs, plus
  the instructions in `CLAUDE.md` and the log. Auto mode removes the prompt. Don't use it with root unless you
  mean it.
- That's why SSH takes one key and one user, and the phone should only be on networks you trust. Remote access from
  outside the LAN is not set up.
- Each `android` call is logged at `/var/log/android-commands.log`, and Claude Code keeps its full transcript in
  `~/.claude/projects/`. The MCP server, which has a narrower tool set, is in [`mcp/`](../../mcp/), with its own log.
- Your Claude sign-in is stored in `/home/rethink/.claude/` on the phone. It is never in this repo.

## Limits

- After a reboot it needs `start.sh` over USB again. Starting at boot is future work.
- It needs a rooted phone (adb root).
