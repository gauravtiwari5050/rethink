#!/bin/sh
# Optional: a terminal on the phone's own screen. Run from the computer after setup.sh (needs adb root).
# Installs the Termux terminal app (pinned, checksummed), gives it OpenSSH and its own key, and adds a
# `debian` command. On the phone: open Termux, type `debian`, then `claude`.
# Termux is an ordinary app without root, so it logs in to the phone's Debian over SSH on 127.0.0.1:2222.
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}

# Termux's official GitHub build. It's debuggable, which lets `run-as` set it up from here.
TERMUX_VERSION=v0.118.3
TERMUX_APK=termux-app_${TERMUX_VERSION}+github-debug_arm64-v8a.apk
TERMUX_SHA256=72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e

mkdir -p .cache
[ -f .cache/$TERMUX_APK ] || curl -fL --progress-bar -o .cache/$TERMUX_APK \
  "https://github.com/termux/termux-app/releases/download/$TERMUX_VERSION/$TERMUX_APK"
echo "$TERMUX_SHA256  .cache/$TERMUX_APK" | shasum -a 256 -c -

$A root >/dev/null; $A wait-for-device
$A install -r .cache/$TERMUX_APK
$A shell 'input keyevent KEYCODE_WAKEUP; am start -n com.termux/.app.TermuxActivity' >/dev/null
printf 'waiting for Termux to finish its first-run setup'
until $A shell 'run-as com.termux ls files/usr/bin/bash' >/dev/null 2>&1; do printf .; sleep 2; done; echo

# runs a script inside Termux, as the Termux app's own user
in_termux() {
  $A shell "run-as com.termux /system/bin/sh -c 'cat > files/usr/tmp/rethink-setup.sh' && \
    run-as com.termux /data/data/com.termux/files/usr/bin/bash /data/data/com.termux/files/usr/tmp/rethink-setup.sh"
}
PUB=$(in_termux <<'EOF' | tail -1
export PREFIX=/data/data/com.termux/files/usr HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin LD_LIBRARY_PATH=$PREFIX/lib TMPDIR=$PREFIX/tmp LANG=en_US.UTF-8
yes | pkg install -y openssh >/dev/null 2>&1
mkdir -p $HOME/.ssh && chmod 700 $HOME/.ssh
[ -f $HOME/.ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C termux-on-phone -f $HOME/.ssh/id_ed25519
ssh-keyscan -p 2222 127.0.0.1 2>/dev/null > $HOME/.ssh/known_hosts
cat > $PREFIX/bin/debian <<'X'
#!/data/data/com.termux/files/usr/bin/sh
# Rethink Phone: log in to the phone's own Debian (phone/linux/ in the repo), where `claude` is installed.
exec ssh -t -p 2222 rethink@127.0.0.1 "$@"
X
chmod 755 $PREFIX/bin/debian
cat $HOME/.ssh/id_ed25519.pub
EOF
)
case "$PUB" in ssh-ed25519\ *) ;; *) echo "Termux setup failed (is start.sh running?): $PUB" >&2; exit 1 ;; esac

# authorize Termux's key for the rethink user in Debian (alongside your computer's key)
AK=/data/local/rethink/debian/home/rethink/.ssh/authorized_keys
$A shell "grep -q termux-on-phone $AK || echo '$PUB' >> $AK"
echo "Done. On the phone: open Termux, type: debian   then: claude"
