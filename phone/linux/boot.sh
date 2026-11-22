#!/system/bin/sh
# Runs on the phone as root (Android's shell, not Debian's). Pushed to /data/local/rethink/ by setup.sh.
#   sh boot.sh mount   mount /proc, /sys, /dev, /dev/pts and /tmp into the Debian tree
#   sh boot.sh start   mount, then start the SSH server (port 2222) and the MCP server (127.0.0.1:7071)
#   sh boot.sh stop    stop both and unmount
R=/data/local/rethink/debian
ENV="/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8"

mounts() {
  # /data is mounted nosuid; re-mount just the Debian tree with suid so sudo works inside it
  mountpoint -q $R         || { mount --bind $R $R && mount -o remount,bind,suid $R; }
  mountpoint -q $R/proc    || mount -t proc proc $R/proc
  mountpoint -q $R/sys     || mount -t sysfs sysfs $R/sys
  mountpoint -q $R/dev     || mount --bind /dev $R/dev
  mountpoint -q $R/dev/pts || mount --bind /dev/pts $R/dev/pts
  mountpoint -q $R/tmp     || mount -t tmpfs -o mode=1777 tmpfs $R/tmp
}

case "$1" in
  mount) mounts ;;
  start)
    mounts
    # Android's own environment (PATH, BOOTCLASSPATH, ...), for the `android` command inside Debian.
    # Debian follows the phone's time zone
    tz=$(getprop persist.sys.timezone); [ -n "$tz" ] && [ -f $R/usr/share/zoneinfo/$tz ] && ln -sf /usr/share/zoneinfo/$tz $R/etc/localtime
    export -p | grep -vE '^export (HOSTNAME|TERM|PWD|OLDPWD|SHLVL|_|HOME|USER|LOGNAME|SHELL|TMPDIR|SSH_[A-Z_]*|ADB_[A-Z_]*)=' \
      > /data/local/rethink/android.env
    if ! pgrep -f '[s]shd: /usr/sbin/sshd' >/dev/null; then
      mkdir -p $R/run/sshd
      chroot $R $ENV /usr/sbin/sshd
    fi
    if ! pgrep -f '[a]pp.rethink.mcp.Server' >/dev/null; then
      setsid nohup app_process -Djava.class.path=/data/local/tmp/rethink/mcp.dex /system/bin \
        app.rethink.mcp.Server 7071 127.0.0.1 >> /data/local/tmp/rethink/mcp.log 2>&1 < /dev/null &
    fi
    sleep 1
    pgrep -f '[s]shd: /usr/sbin/sshd' >/dev/null && echo "ssh: port 2222 on $(ip -4 -o addr show wlan0 | awk '{print $4}' | cut -d/ -f1)" || echo "ssh: NOT running"
    pgrep -f '[a]pp.rethink.mcp.Server' >/dev/null && echo "mcp: 127.0.0.1:7071 (log: /data/local/tmp/rethink/mcp.log)" || echo "mcp: NOT running"
    ;;
  stop)
    pkill -f '[s]shd: /usr/sbin/sshd'
    pkill -f '[a]pp.rethink.mcp.Server'
    # unmount everything under the Debian tree, deepest first (Android's shared mounts can add extras)
    n=0; while m=$(grep " $R" /proc/mounts | tail -1 | cut -d' ' -f2) && [ -n "$m" ] && [ $((n+=1)) -lt 50 ]; do
      umount -l "$m"; done
    echo stopped ;;
  *) echo "usage: sh boot.sh mount|start|stop" >&2; exit 2 ;;
esac
