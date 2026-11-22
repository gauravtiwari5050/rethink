#!/system/bin/sh
# Runs on the phone as root (Android's shell, not Debian's). Pushed to /data/local/rethink/ by setup.sh.
#   sh boot.sh mount   mount /proc, /sys, /dev, /dev/pts and /tmp into the Debian tree
#   sh boot.sh start   mount, then start the SSH server (port 2222) and the MCP server (127.0.0.1:7071)
#   sh boot.sh stop    stop both and unmount
R=/data/local/rethink/debian
ENV="/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8"

mounts() {
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
    for m in tmp dev/pts dev sys proc; do mountpoint -q $R/$m && umount $R/$m; done
    echo stopped ;;
  *) echo "usage: sh boot.sh mount|start|stop" >&2; exit 2 ;;
esac
