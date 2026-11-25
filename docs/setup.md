# Set up your phone

> [!WARNING]
> **Highly experimental. Proceed with caution.** This means unlocking the bootloader, flashing a new operating
> system and running code as root. One wrong step can brick your phone or erase everything on it, and there is no
> warranty or support. Use a spare phone you can afford to lose, and follow each step exactly.

Every experiment starts here. Part 1 gets a rooted LineageOS phone talking to your computer. Part 2 puts a small
Debian system and Claude Code on the phone. [Experiment 01](reproduce/01-claude-operates-the-phone.md) needs only
Part 1; [02](reproduce/02-claude-runs-on-the-phone.md) and [03](reproduce/03-a-phone-call-orders-groceries.md) need both.

Everything was tested on the setup below. Other phones that LineageOS supports should work, but haven't been tried.

| | |
|---|---|
| Phone | OnePlus Nord CE 3 Lite 5G (CPH2467, codename `larry`), Airtel SIM with VoLTE |
| Phone OS | LineageOS 24.0 (Android 17), nightly of 14 Nov 2026 |
| Computer | macOS on Apple Silicon |
| Computer tools | Android SDK platform-tools, platform 35, build-tools 35.0.0; JDK 17 or newer; git |

## Part 1: a rooted phone your computer can reach

### 1. Install LineageOS

Follow LineageOS's own guide for your phone. For the Nord CE 3 Lite (CPH2465 or CPH2467) it's
[wiki.lineageos.org/devices/larry/install/variant1](https://wiki.lineageos.org/devices/larry/install/variant1); other
phones are listed at [wiki.lineageos.org/devices](https://wiki.lineageos.org/devices/). It covers unlocking
the bootloader, flashing the recovery and installing LineageOS. Skip Google apps if you don't need them; nothing here
uses them.

Boot the phone, finish the setup screens, connect it to Wi-Fi, and put in a SIM if you'll try calls
([Experiment 03](reproduce/03-a-phone-call-orders-groceries.md)).

### 2. Turn on rooted debugging

On the phone:

1. **Settings → About phone**, tap **Build number** seven times. Developer options are now on.
2. **Settings → System → Developer options**: turn on **USB debugging** and **Rooted debugging**.
3. Plug the phone into your computer and accept the **Allow USB debugging?** prompt (tick *Always allow*).

### 3. Install the tools on your computer

You need `adb`, the Android SDK pieces that build the phone-side Java code, a JDK and git.

**The easy way:** install [Android Studio](https://developer.android.com/studio), open **Settings → Languages &
Frameworks → Android SDK**, and install **Android SDK Platform 35**, **Android SDK Build-Tools 35.0.0** and
**Android SDK Platform-Tools**. On macOS the SDK lands in `~/Library/Android/sdk`, which is where the scripts look by
default. Android Studio ships a JDK; put it on your path:

```sh
export PATH="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin:$PATH"
```

**Without Android Studio:** install the
[command-line tools](https://developer.android.com/studio#command-line-tools-only) and a JDK 17+, then

```sh
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

and tell the scripts where the SDK is:

```sh
export ANDROID_HOME=/path/to/your/android/sdk
export ADB=$ANDROID_HOME/platform-tools/adb
```

Put those `export` lines in your shell profile so they're set in every terminal.

With Android Studio on macOS you don't need `ANDROID_HOME`, but the guides use `$ADB` for adb, so add this to your
profile too:

```sh
export ADB=$HOME/Library/Android/sdk/platform-tools/adb
```

### 4. Get the code

```sh
git clone https://github.com/gauravtiwari5050/rethink
cd rethink
```

All commands from here on run from this folder.

### 5. Check root

```sh
$ADB root
$ADB shell id
```

You should see `uid=0(root)`. If `adb root` says *adbd cannot run as root in production builds*, rooted debugging
is off (step 2) or the phone isn't running a build that allows it.

That's Part 1. You can now run [Experiment 01](reproduce/01-claude-operates-the-phone.md).

## Part 2: Debian and Claude Code on the phone

### 6. Install Debian, SSH and Claude Code on the phone

```sh
./phone/linux/setup.sh
```

This takes about three minutes. It:

- downloads Debian 13 (arm64, 28 MB, checksum-verified) and unpacks it into `/data/local/rethink/debian` on the phone;
- installs an SSH server on port 2222 for one user, `rethink`, with key login only;
- installs Claude Code 2.1.330 and Node.js, and a `sudo android <command>` helper that runs commands in Android's
  root shell;
- creates an SSH key for this, `~/.ssh/rethink_phone`, on your computer.

It's safe to run again. Details: [`phone/linux/`](../phone/linux/).

### 7. Start the services

```sh
./phone/linux/start.sh
```

It builds the phone-side code, pushes it, and starts everything on the phone. The last lines show what's running:

```
ssh: port 2222 on 192.168.1.23
mcp: 127.0.0.1:7071
browser: Chromium DevTools on 127.0.0.1:9222
call bridge: NOT running
call answering: on (answers after 2 s)
```

`call bridge: NOT running` is expected until you set it up in
[Experiment 03](reproduce/03-a-phone-call-orders-groceries.md). Note the address on the first line: it's the phone's
address on your Wi-Fi.

**Run `start.sh` again after every reboot of the phone.** Nothing starts on its own yet.

### 8. Sign in to Claude on the phone

Your computer and the phone must be on the same Wi-Fi. Using the address from step 7:

```sh
ssh -i ~/.ssh/rethink_phone -p 2222 rethink@192.168.1.23
claude
```

Claude Code asks you to sign in. It prints a link: open it on your computer, sign in with your Claude account
(a Pro or Max plan, or an Anthropic Console account), and paste the code back. Then ask it something about the
phone to check it works, for example `what's the battery level?`. It will run `sudo android dumpsys battery`.

Type `/exit` to leave Claude, and `exit` to leave the phone.

## Stopping, and removing everything

- Stop all services: `$ADB shell sh /data/local/rethink/boot.sh stop`
- Remove everything this set up: stop, then `$ADB shell rm -rf /data/local/rethink /data/local/tmp/rethink`

## What you've given root to

Claude on the phone has root. It can read any app's data or wipe the phone. Claude Code asks before each command
unless you turn on auto mode. Every `sudo android` command is logged in `/var/log/android-commands.log` in Debian.
SSH accepts only your key. Keep the phone on networks you trust.
