# Claude Code on the phone

Runs a small Debian system on the phone, with an SSH server and Claude Code. You SSH into the phone, start
`claude`, and it operates the phone through the phone's own [MCP server](../../mcp/) on `127.0.0.1:7071`.
The model runs in Anthropic's cloud, as it does on a laptop. The agent, its tools and its log are on the phone.

## How it works

- **Debian 13 "trixie" (arm64)**, unpacked into `/data/local/rethink/debian` and entered with `chroot`. It's the root
  filesystem of Docker's official `debian:trixie-slim` image. `setup.sh` pins its commit and SHA-256.
- **OpenSSH** on port 2222, for one user, `rethink`. It accepts key logins only: no passwords and no root login.
- **Claude Code**, the official native Linux arm64 build, pinned in `setup.sh`. The phone's MCP server is
  registered for the `rethink` user as `rethink-phone`.
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

On the phone, `sh /data/local/rethink/boot.sh stop` stops both servers and unmounts. To remove everything, run that
and then `rm -rf /data/local/rethink`.

## Security, stated plainly

- `chroot` is not a sandbox. Root inside Debian is root on the phone, and the MCP server can place calls and send
  texts. Anyone with the SSH key can do what Claude can.
- That's why SSH takes one key and one user, and the phone should only be on networks you trust. Remote access from
  outside the LAN is not set up.
- Claude Code asks before each tool call unless you switch on auto mode. Every tool call is logged on the phone at
  `/data/local/tmp/rethink/mcp-audit.jsonl`.
- Your Claude sign-in is stored in `/home/rethink/.claude/` on the phone. It is never in this repo.

## Limits

- After a reboot it needs `start.sh` over USB again. Starting at boot is future work.
- It needs root, like the MCP server.
