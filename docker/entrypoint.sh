#!/bin/bash
# entrypoint.sh - Initialize firewall as root, then run command as non-root node user
# This allows --dangerously-skip-permissions to work (requires non-root)

set -e

# Run firewall initialization as root (requires CAP_NET_ADMIN)
echo "Initializing firewall as root..."
/usr/local/bin/init-firewall.sh

# Fix workspace permissions for node user
chown -R node:node /workspace 2>/dev/null || true

# Fix SSH permissions (mounted read-only, but need correct perms for git)
if [ -d /home/node/.ssh ]; then
    mkdir -p /tmp/.ssh
    cp -r /home/node/.ssh/* /tmp/.ssh/ 2>/dev/null || true
    chown -R node:node /tmp/.ssh
    chmod 700 /tmp/.ssh
    chmod 600 /tmp/.ssh/* 2>/dev/null || true

    # Only configure SSH for git if we actually have private keys
    if [ -f /tmp/.ssh/id_rsa ] || [ -f /tmp/.ssh/id_ed25519 ]; then
        KEY_FILE="/tmp/.ssh/id_rsa"
        [ -f /tmp/.ssh/id_ed25519 ] && KEY_FILE="/tmp/.ssh/id_ed25519"
        git config --system core.sshCommand "ssh -i $KEY_FILE -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
    fi
fi

# Configure gh CLI as git credential helper (for HTTPS auth)
if [ -n "$GITHUB_TOKEN" ]; then
    git config --system credential.helper '!gh auth git-credential'
fi

# Drop privileges and execute command as node user
echo "Dropping privileges to node user..."
exec gosu node "$@"
