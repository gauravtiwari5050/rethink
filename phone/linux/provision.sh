#!/bin/sh
# Runs inside the Debian chroot on the phone, as root, from setup.sh. Safe to re-run.
set -e
export DEBIAN_FRONTEND=noninteractive

# Android has no /etc/resolv.conf for us to share, so use public resolvers.
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf

# Android only lets processes in group 3003 (AID_INET) open network sockets.
grep -q '^aid_inet:' /etc/group || groupadd -g 3003 aid_inet
grep -q '^aid_net_raw:' /etc/group || groupadd -g 3004 aid_net_raw
# apt downloads as the unprivileged _apt user, which is not in that group; download as root instead.
echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/01-android-network

apt-get update
apt-get install -y --no-install-recommends openssh-server tmux git curl ca-certificates less procps tzdata
printf '127.0.0.1 localhost\n::1 localhost\n' > /etc/hosts

id rethink >/dev/null 2>&1 || useradd -m -s /bin/bash rethink
usermod -aG aid_inet,aid_net_raw rethink
usermod -p '*' rethink   # no password, but not locked: key login only

install -d -m 700 -o rethink -g rethink /home/rethink/.ssh
# add the computer's key, keeping any already there (e.g. Termux's, from termux.sh)
AK=/home/rethink/.ssh/authorized_keys
touch $AK
while read -r k; do [ -n "$k" ] && ! grep -qxF "$k" $AK && echo "$k" >> $AK; done < /root/authorized_keys
chown rethink:rethink $AK && chmod 600 $AK

cat > /etc/ssh/sshd_config.d/rethink.conf <<'EOF'
# Rethink Phone: key-only logins for one user.
Port 2222
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers rethink
UsePAM no
EOF
mkdir -p /run/sshd

# Claude Code, the official native Linux arm64 build, pinned.
su - rethink -c "curl -fsSL https://claude.ai/install.sh | bash -s $CLAUDE_CODE_VERSION"
grep -q '.local/bin' /home/rethink/.profile || echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/rethink/.profile

# Root: `rethink` may use sudo, and `android` runs a command in the phone's real Android root shell.
# It enters init's root filesystem through /proc/1/root (Debian's /proc is Android's) with Android's
# environment, which boot.sh saves. Every call is appended to /var/log/android-commands.log.
apt-get install -y --no-install-recommends sudo
echo 'rethink ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/rethink && chmod 440 /etc/sudoers.d/rethink
cat > /usr/local/bin/android <<'EOF'
#!/bin/bash
# Rethink Phone: run a command in Android's root shell, e.g.  sudo android input tap 540 1200
# Logged to /var/log/android-commands.log. Needs root (sudo).
[ "$(id -u)" = 0 ] || { echo "android: needs root, use: sudo android $*" >&2; exit 1; }
[ $# -gt 0 ] || { echo "usage: sudo android <command...>" >&2; exit 2; }
printf '%s\t%s\t%s\n' "$(date -Iseconds)" "${SUDO_USER:-root}" "$*" >> /var/log/android-commands.log
# Output always goes through pipes: `am` and `cmd` hand their stdout/stderr to Android's system_server, and
# SELinux won't let it write to files in Debian (e.g. where Claude Code collects command output).
[ -p /dev/stdin ] && IN=/dev/stdin || IN=/dev/null
set -o pipefail
chroot /proc/1/root /system/bin/sh -c '. /data/local/rethink/android.env; cd /; eval "$1"' android "$*" \
  < $IN 2> >(cat >&2) | cat
EOF
chmod 755 /usr/local/bin/android

cat > /home/rethink/CLAUDE.md <<'EOF'
# You are running on the phone

This is Debian Linux inside a phone: a OnePlus Nord CE 3 Lite (1080×2400 screen) running LineageOS, Android 17.
The person talking to you may be holding it.

You have root. `sudo android <command>` runs a command in Android's root shell (every call is logged).
Useful commands:

- Read the screen: `sudo android 'uiautomator dump /sdcard/ui.xml >/dev/null && cat /sdcard/ui.xml'`
  (UI elements with text and `bounds="[x1,y1][x2,y2]"`; tap the centre of an element's bounds)
- Screenshot: `sudo android screencap -p > /tmp/screen.png`, then view /tmp/screen.png
- Tap / swipe / type / keys: `sudo android input tap X Y`, `input swipe X1 Y1 X2 Y2`, `input text 'hello%sworld'`
  (`%s` is a space), `input keyevent KEYCODE_HOME|KEYCODE_BACK|KEYCODE_ENTER|KEYCODE_ENDCALL`
- Contacts: `sudo android content query --uri content://com.android.contacts/data/phones --projection display_name:data1`
- Call: `sudo android am start -a android.intent.action.CALL -d tel:NUMBER`; hang up: `input keyevent KEYCODE_ENDCALL`
- SMS: `sudo android am start -a android.intent.action.SENDTO -d smsto:NUMBER --es sms_body 'text'` opens Messages
  with the text filled in; then read the screen and tap Send
- Apps: `sudo android monkey -p PACKAGE -c android.intent.category.LAUNCHER 1`; status: `sudo android dumpsys battery`

Before anything that reaches another person (calls, messages) or can't be undone, say what you're about to do.
Never change system settings, delete data, or install or remove apps unless asked to.
EOF
chown rethink:rethink /home/rethink/CLAUDE.md

# Claude works through the shell above. To use the MCP server instead (mcp/), run as rethink:
#   claude mcp add --scope user --transport http rethink-phone http://127.0.0.1:7071/mcp
su - rethink -c 'claude mcp remove --scope user rethink-phone >/dev/null 2>&1' || true

echo "provisioned: $(. /etc/os-release; echo $PRETTY_NAME), $(su - rethink -c 'claude --version')"
