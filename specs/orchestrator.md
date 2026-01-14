# Orchestrator Specification

**File**: `ralph.ts`
**Purpose**: External loop that spawns Claude in isolated Docker containers to implement features iteratively

## Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         STARTUP                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. cleanupStaleContainers()                                    │
│  2. Validate environment                                         │
│     - CLAUDE_CODE_OAUTH_TOKEN required                          │
│     - Must be in git repository                                  │
│     - features.json must exist and be valid                     │
│  3. createSession()                                              │
│     - Create container with firewall                            │
│     - Copy project files                                         │
│     - Checkout/create branch                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN LOOP                                   │
│                 (max N iterations)                               │
├─────────────────────────────────────────────────────────────────┤
│  for each iteration:                                             │
│    1. ensureContainerRunning()                                  │
│    2. Read features.json from container                         │
│    3. Filter remaining features (passes: false)                 │
│    4. If none remaining → push & break                          │
│    5. Write .ralph-prompt.md (instructions for Claude)          │
│    6. runClaudeInContainer() with 5-minute timeout              │
│    7. Check for git changes:                                     │
│       - hasUnpushedCommits() → push, reset noChangeCount        │
│       - No changes → increment noChangeCount                    │
│    8. Circuit breaker: noChangeCount >= 3 → abort               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CLEANUP                                   │
├─────────────────────────────────────────────────────────────────┤
│  finally:                                                        │
│    - updateState({ running: false })                            │
│    - cleanupSession(containerName)                              │
└─────────────────────────────────────────────────────────────────┘
```

## Key Functions

### `cleanupStaleContainers()`
Removes containers from previous Ralph sessions.

```typescript
// Pattern: containers named "ralph-*"
const output = await Bun.$`docker ps -a --filter name=ralph- --format {{.Names}}`.text()
const containers = parseStaleContainers(output)
for (const name of containers) {
  await Bun.$`docker rm -f ${name}`.nothrow().quiet()
}
```

### `ensureContainerRunning(containerName: string)`
Health check with automatic restart.

```typescript
const output = await Bun.$`docker inspect -f {{.State.Running}} ${containerName}`.text()
if (!parseContainerRunning(output)) {
  await Bun.$`docker start ${containerName}`
}
```

### `createSession(config: SessionConfig)`
Creates and initializes a new container session.

**Steps:**
1. Generate unique container name: `ralph-{timestamp}`
2. Create container with required capabilities
3. Start container (runs entrypoint.sh)
4. Wait for firewall initialization ("Ralph Firewall Ready")
5. Copy project via tar stream
6. Fix permissions (`chown node:node`)
7. Fetch and checkout branch

**Docker create command:**
```bash
docker create \
  --name ralph-1234567890 \
  --cap-add=NET_ADMIN \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e GITHUB_TOKEN \
  -v ~/.ssh:/root/.ssh:ro \
  ralph-base:latest \
  tail -f /dev/null
```

### `runClaudeInContainer(containerName: string, prompt: string)`
Executes Claude with timeout and output streaming.

**Command:**
```bash
docker exec -u node <container> \
  claude -p \
  --dangerously-skip-permissions \
  --verbose \
  --output-format stream-json \
  "<prompt>"
```

**Timeout handling:**
```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000)

try {
  const proc = Bun.spawn([...], { signal: controller.signal })
  // Stream output...
} catch (e) {
  if (e instanceof Error && e.name === "AbortError") {
    // Timeout reached - kill Claude process
  }
}
```

## Circuit Breaker Logic

Prevents infinite loops when Claude gets stuck:

```typescript
let noChangeCount = 0
const MAX_NO_CHANGE = 3

// After each iteration:
if (hasUnpushedCommits(gitLogOutput)) {
  await pushChanges()
  noChangeCount = 0  // Reset on successful change
} else {
  noChangeCount++
  if (noChangeCount >= MAX_NO_CHANGE) {
    console.error("Circuit breaker: No git changes for 3 iterations")
    break
  }
}
```

## Configuration

### CLI Arguments
See `src/args.ts` for parsing logic.

| Argument | Default | Description |
|----------|---------|-------------|
| `[features.json]` | `features.json` | Path to features file |
| `--branch <name>` | auto-generated | Resume existing branch |
| `--once` | `false` | Run single iteration only |
| `--max-iterations <n>` | `5` | Maximum loop iterations |
| `--dashboard` | `false` | Enable web dashboard |
| `--dashboard-port <n>` | `3847` | Dashboard server port |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Authentication for Claude API |
| `GITHUB_TOKEN` | No | Auto-detected via `gh auth token` |

## State Management

### Orchestrator State (in-memory)
```typescript
let iteration = 0
let noChangeCount = 0
let containerName: string
```

### Persistent State (container filesystem)
- `/workspace/features.json` - Feature completion status
- `/workspace/.git/` - Git history and branches
- `/workspace/ralph-progress.txt` - Claude's learning notes
- `/workspace/.ralph-prompt.md` - Current iteration instructions

### Dashboard State (optional)
Managed by `src/server.ts`, broadcast via SSE:
```typescript
interface DashboardState {
  paused: boolean
  running: boolean
  containerName: string
  branch: string
  features: Feature[]
}
```

## Error Handling

### Validation Errors (exit immediately)
- Missing `CLAUDE_CODE_OAUTH_TOKEN`
- Not in a git repository
- Invalid or missing features.json
- No features defined

### Runtime Errors (retry or abort)
- Container not running → restart via `ensureContainerRunning()`
- Claude timeout → increment noChangeCount, continue
- Git push failure → log error, continue
- Circuit breaker triggered → abort with message

## Integration Points

| Component | Integration |
|-----------|-------------|
| Container | `createSession()`, `ensureContainerRunning()` |
| Features | Read via `docker exec cat`, parsed by `getRemainingFeatures()` |
| Claude | Spawned via `runClaudeInContainer()` |
| Dashboard | State updates via `src/server.ts` functions |
| Git | Branch management, change detection, push operations |
