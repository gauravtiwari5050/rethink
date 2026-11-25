# Reproduce Experiment 02: Claude runs on the phone, with root

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

Claude Code runs on the phone itself, in a small Debian, with root. You open it in a terminal app on the phone and
ask it to call a contact. Write-up and video: [Experiment 02](https://rethinkphone.tech/experiments/claude-runs-on-the-phone/).

## You need

- [The setup, Parts 1 and 2](../setup.md): Debian and Claude Code on the phone, services started, Claude signed in.
- A SIM in the phone, and at least one contact saved in the phone's Contacts app.

## Steps

1. **Install the terminal app**, with the phone on USB:

   ```sh
   ./phone/linux/termux.sh
   ```

   It installs [Termux](https://github.com/termux/termux-app) v0.118.3 (checksum-verified), gives it its own SSH key,
   and adds a `debian` command. Termux is an ordinary app without root; it reaches the phone's Debian over SSH on
   `127.0.0.1`. You can unplug USB afterwards.

   Rather work from your computer? Skip this and SSH in instead:
   `ssh -i ~/.ssh/rethink_phone -p 2222 rethink@<phone's Wi-Fi address>`.

2. **Open Termux on the phone** and type:

   ```sh
   debian
   claude
   ```

   Claude Code starts in `/home/rethink`, on the phone. A `CLAUDE.md` there tells it it's on the phone and lists the
   Android commands it can use.

3. **Ask it to call someone in your contacts:**

   ```
   Can you call <contact name>
   ```

   It looks the contact up with `content query` and dials with `am start -a android.intent.action.CALL`. The dialer
   comes up. Claude Code asks before each command; approve them, or press Shift+Tab for auto mode, as in the video.

4. **Hang up** by asking `hang up`, or on the phone.

5. **Read the log** of every root command Claude ran, in Debian:

   ```sh
   cat /var/log/android-commands.log
   ```

## Typing on the phone

The video was typed on a laptop keyboard through [scrcpy](https://github.com/Genymobile/scrcpy), which mirrors the
phone's screen and forwards keystrokes (`brew install scrcpy`, then `scrcpy`). The phone's own keyboard works too.

## If something's off

- **`debian` says connection refused:** the services aren't running, usually after a reboot. Run
  `./phone/linux/start.sh` again with the phone on USB.
- **Calls fail with `Failed transaction`:** you're on an old checkout. The `android` helper now passes output
  through a pipe, which fixes it; re-run `./phone/linux/setup.sh`.
- **`claude` asks you to sign in:** do step 8 of the setup.

## Code

[`phone/linux/`](../../phone/linux/): `setup.sh` and `provision.sh` (Debian, SSH, Claude Code, the `android` helper,
`CLAUDE.md`), `boot.sh` (mounts and services on the phone), `termux.sh`.
