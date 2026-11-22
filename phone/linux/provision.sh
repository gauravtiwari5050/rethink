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
apt-get install -y --no-install-recommends openssh-server tmux git curl ca-certificates less procps

id rethink >/dev/null 2>&1 || useradd -m -s /bin/bash rethink
usermod -aG aid_inet,aid_net_raw rethink
usermod -p '*' rethink   # no password, but not locked: key login only

install -d -m 700 -o rethink -g rethink /home/rethink/.ssh
install -m 600 -o rethink -g rethink /root/authorized_keys /home/rethink/.ssh/authorized_keys

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
# The phone's own MCP server, on the phone's localhost.
su - rethink -c 'claude mcp remove --scope user rethink-phone >/dev/null 2>&1; claude mcp add --scope user --transport http rethink-phone http://127.0.0.1:7071/mcp'

# Read-only phone tools run without asking; calling, hanging up, tapping and typing still ask.
# (On the phone's own screen, a prompt would otherwise hide behind the dialer while Claude checks it.)
S=/home/rethink/.claude/settings.json
if [ ! -f $S ]; then
  install -d -o rethink -g rethink /home/rethink/.claude
  cat > $S <<'EOF'
{
  "permissions": {
    "allow": [
      "mcp__rethink-phone__device_status",
      "mcp__rethink-phone__get_screen",
      "mcp__rethink-phone__find_contact"
    ]
  }
}
EOF
  chown rethink:rethink $S
fi

echo "provisioned: $(. /etc/os-release; echo $PRETTY_NAME), $(su - rethink -c 'claude --version')"
