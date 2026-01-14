# Container Specification

**Files**: `src/container.ts`, `docker/Dockerfile.base`, `docker/entrypoint.sh`
**Purpose**: Docker container lifecycle management and pure utility functions

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ralph-base:latest                          │
│                     (Docker Image)                              │
├─────────────────────────────────────────────────────────────────┤
│  Base: node:22-slim                                             │
│                                                                  │
│  Installed:                                                      │
│  ├─ Claude Code CLI (@anthropic-ai/claude-code)                 │
│  ├─ GitHub CLI (gh)                                             │
│  ├─ Network tools (iptables, ipset, curl, dig)                  │
│  ├─ Git, jq, openssh-client                                     │
│  └─ Privilege tools (sudo, gosu)                                │
│                                                                  │
│  User: node (non-root, UID 1000)                                │
│  Workdir: /workspace                                            │
│  Entrypoint: /usr/local/bin/entrypoint.sh                       │
└─────────────────────────────────────────────────────────────────┘
```

## Container Lifecycle

### 1. Creation
```bash
docker create \
  --name ralph-{timestamp} \
  --cap-add=NET_ADMIN \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e GITHUB_TOKEN \
  -v ~/.ssh:/root/.ssh:ro \
  ralph-base:latest \
  tail -f /dev/null
```

**Required capability**: `NET_ADMIN` for iptables firewall setup

### 2. Startup (entrypoint.sh)
```
┌─────────────────────────────────────────────────────────────────┐
│  1. Run as root initially                                        │
│  2. Execute init-firewall.sh                                     │
│  3. Copy SSH keys to /tmp/.ssh/ (fix permissions)               │
│  4. Configure git credential helper                              │
│  5. Drop privileges via gosu                                     │
│  6. Execute command as 'node' user                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Project Copy
```bash
# From host to container via tar stream
tar -c --exclude=node_modules --exclude=.git ... | \
  docker exec -i <container> tar -x -C /workspace

# Fix ownership
docker exec <container> chown -R node:node /workspace
```

### 4. Git Setup
```bash
# Inside container
git config --system safe.directory /workspace
git config --system credential.helper '!gh auth git-credential'
git config --system core.sshCommand "ssh -i /tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"
```

### 5. Cleanup
```bash
docker rm -f <container>
```

## Pure Utility Functions (`src/container.ts`)

These functions have no side effects and are fully testable without Docker.

### `generateContainerName(sessionId?: string): string`
```typescript
// Returns: "ralph-{timestamp}" or "ralph-{sessionId}"
generateContainerName()           // → "ralph-1704067200000"
generateContainerName("abc123")   // → "ralph-abc123"
```

### `parseStaleContainers(dockerPsOutput: string): string[]`
```typescript
// Input: docker ps -a --filter name=ralph- --format {{.Names}}
// Output: Array of container names
parseStaleContainers("ralph-123\nralph-456")  // → ["ralph-123", "ralph-456"]
parseStaleContainers("")                       // → []
```

### `parseContainerRunning(inspectOutput: string): boolean`
```typescript
// Input: docker inspect -f {{.State.Running}} output
parseContainerRunning("true\n")   // → true
parseContainerRunning("false\n")  // → false
parseContainerRunning("")         // → false
```

### `getRemainingFeatures(featuresJson: string): Feature[]`
```typescript
// Filters for features with passes: false
const json = '{"features":[{"id":"a","passes":false},{"id":"b","passes":true}]}'
getRemainingFeatures(json)  // → [{ id: "a", passes: false, ... }]
```

### `hasUnpushedCommits(gitLogOutput: string): boolean`
```typescript
// Input: git log origin/branch..HEAD --oneline
hasUnpushedCommits("abc123 Some commit")  // → true
hasUnpushedCommits("")                     // → false
```

## Dockerfile Breakdown (`docker/Dockerfile.base`)

```dockerfile
FROM node:22-slim

# Network tools for firewall
RUN apt-get update && apt-get install -y \
    iptables ipset iproute2 aggregate \
    curl dnsutils \
    # ...

# Git and GitHub CLI
RUN apt-get install -y git openssh-client
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | ...

# Privilege management
RUN apt-get install -y sudo gosu

# Claude Code CLI (npm global)
RUN npm install -g @anthropic-ai/claude-code

# Non-root user setup
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

## Entrypoint Script (`docker/entrypoint.sh`)

```bash
#!/bin/bash
set -e

# 1. Initialize firewall (requires root)
/usr/local/bin/init-firewall.sh

# 2. Copy SSH keys with correct permissions
if [ -d /root/.ssh ]; then
    mkdir -p /tmp/.ssh
    cp /root/.ssh/* /tmp/.ssh/ 2>/dev/null || true
    chmod 700 /tmp/.ssh
    chmod 600 /tmp/.ssh/* 2>/dev/null || true
    chown -R node:node /tmp/.ssh
fi

# 3. Configure git
git config --system safe.directory /workspace
git config --system credential.helper '!gh auth git-credential'
git config --system core.sshCommand "ssh -i /tmp/.ssh/id_rsa -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# 4. Drop privileges and execute command
exec gosu node "$@"
```

## Security Considerations

### Non-root Execution
Claude Code requires `--dangerously-skip-permissions` flag, which only works when running as non-root user. The container:
1. Starts as root for firewall setup
2. Drops to `node` user (UID 1000) via `gosu`
3. All Claude operations run as `node`

### Capability Restrictions
Only `NET_ADMIN` capability is granted (for iptables). Container cannot:
- Access host network namespace
- Mount host filesystems (except SSH keys read-only)
- Escalate privileges

### File Permissions
```bash
# Workspace owned by node user
chown -R node:node /workspace

# SSH keys copied with restricted permissions
chmod 700 /tmp/.ssh
chmod 600 /tmp/.ssh/*
```

## Testing

Container utilities are tested without Docker:

```typescript
// src/container.test.ts
import { describe, expect, test } from "bun:test"
import { parseStaleContainers, getRemainingFeatures } from "./container"

describe("parseStaleContainers", () => {
  test("parses multiple containers", () => {
    expect(parseStaleContainers("ralph-1\nralph-2")).toEqual(["ralph-1", "ralph-2"])
  })

  test("handles empty output", () => {
    expect(parseStaleContainers("")).toEqual([])
  })
})
```

## Integration with Orchestrator

| Orchestrator Function | Container Operations |
|-----------------------|----------------------|
| `cleanupStaleContainers()` | `docker ps`, `docker rm` |
| `createSession()` | `docker create`, `docker start`, `tar`, `docker exec` |
| `ensureContainerRunning()` | `docker inspect`, `docker start` |
| `runClaudeInContainer()` | `docker exec` |
| Cleanup | `docker rm -f` |
