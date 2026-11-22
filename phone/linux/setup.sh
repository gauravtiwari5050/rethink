#!/bin/sh
# One-time setup, run from a computer with the phone on USB (needs adb root):
# unpacks a pinned Debian 13 (arm64) into /data/local/rethink/debian on the phone, installs an SSH server
# and Claude Code, and authorizes one SSH key for the user "rethink".
#   ./phone/linux/setup.sh [path/to/key.pub]     default key: ~/.ssh/rethink_phone (created if missing)
# Re-running it is safe: the Debian tree is only unpacked once (FORCE=1 to start over).
set -e
cd "$(dirname "$0")"
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}

# Debian 13.7 "trixie" slim, arm64: the same root filesystem as Docker's official debian:trixie-slim image.
# Pinned to a commit of github.com/debuerreotype/docker-debian-artifacts; the SHA-256 is also its OCI blob digest.
DEBIAN_COMMIT=5994ab615f09f401eef80676e152b497e2a7b3ba
DEBIAN_URL=https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/$DEBIAN_COMMIT/trixie/slim/oci/blobs/rootfs.tar.gz
DEBIAN_SHA256=247b26a4519187bec80e4b91bfca39d2882f58e608b9ac5a8d753f860823fad8
CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION:-2.1.330}

KEY=${1:-$HOME/.ssh/rethink_phone.pub}
if [ ! -f "$KEY" ]; then
  [ -n "$1" ] && { echo "no such key: $KEY" >&2; exit 1; }
  echo "creating a dedicated SSH key: ~/.ssh/rethink_phone"
  ssh-keygen -q -t ed25519 -N '' -C rethink-phone -f "$HOME/.ssh/rethink_phone"
fi

mkdir -p .cache
if [ ! -f .cache/rootfs.tar.gz ]; then
  echo "downloading Debian root filesystem (28 MB)"
  curl -fL --progress-bar -o .cache/rootfs.tar.gz.part "$DEBIAN_URL" && mv .cache/rootfs.tar.gz.part .cache/rootfs.tar.gz
fi
echo "$DEBIAN_SHA256  .cache/rootfs.tar.gz" | shasum -a 256 -c -

$A root >/dev/null; $A wait-for-device
R=/data/local/rethink
$A shell "mkdir -p $R"
$A push boot.sh provision.sh $R/ >/dev/null
$A push "$KEY" $R/authorized_keys >/dev/null

if [ "$FORCE" = 1 ]; then $A shell "sh $R/boot.sh stop; rm -rf $R/debian"; fi
if $A shell "[ -d $R/debian/etc ]"; then
  echo "Debian already unpacked on the phone; keeping it"
else
  echo "unpacking Debian on the phone"
  $A push .cache/rootfs.tar.gz /data/local/tmp/rethink-rootfs.tar.gz >/dev/null
  $A shell "mkdir -p $R/debian && tar -xzf /data/local/tmp/rethink-rootfs.tar.gz -C $R/debian && rm /data/local/tmp/rethink-rootfs.tar.gz"
fi

$A shell "sh $R/boot.sh mount"
$A shell "cp $R/provision.sh $R/debian/root/provision.sh && cp $R/authorized_keys $R/debian/root/authorized_keys"
$A shell "chroot $R/debian /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 CLAUDE_CODE_VERSION=$CLAUDE_CODE_VERSION /bin/sh /root/provision.sh"

echo
echo "Done. Start it with: ./phone/linux/start.sh"
