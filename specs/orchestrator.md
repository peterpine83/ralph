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
│     - Clone project from remote (not copy)                      │
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
│    4. If none remaining:                                         │
│       - First time: set finalVerificationDone, run Claude       │
│       - Second time: mark PR ready & break                      │
│    5. Write .ralph-prompt.md (instructions for Claude)          │
│    6. runClaudeInContainer() with 5-minute timeout              │
│    7. Check for git changes:                                     │
│       - hasUnpushedCommits() → push, reset noChangeCount        │
│       - If pushed, reset finalVerificationDone                  │
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
5. Clone project from remote repository (ensures clean state, no local uncommitted changes)
6. Fix permissions (`chown node:node`)
7. For new sessions: create branch, copy local features.json
8. For resume: checkout existing branch from remote

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

## Per-Feature CI Verification

**Critical:** Claude must run the full CI suite after implementing EVERY feature. This is a mandatory gate—Claude cannot proceed without CI passing.

### CI Suite (run after each feature)
1. `bun run typecheck` (or project equivalent)
2. `bun test` (or project equivalent)
3. `bun run build` (if build script exists)
4. Feature's `verify_command` (if present)

### The Rule
- Claude CANNOT mark `passes: true` until ALL checks pass
- Claude CANNOT commit until ALL checks pass
- Claude CANNOT move to the next feature until ALL checks pass
- If CI fails, Claude must fix the issues and rerun CI

### Why This Matters
Each feature must leave the codebase in a working state. Without per-feature verification:
- Bugs compound across features
- The next iteration inherits broken code
- The PR fails CI and blocks merging

The orchestrator delegates verification entirely to Claude via instructions. Claude is responsible for running CI and fixing failures before marking any feature complete.

## Final Verification

When all features are marked `passes: true`, run one additional iteration for Claude to verify the entire project.

```typescript
let finalVerificationDone = false

// When remaining.length === 0:
if (finalVerificationDone) {
  // Second time seeing all features complete - PR is ready
  await markPRReady()
  break
}
// First time - run Claude for final verification
finalVerificationDone = true
// Continue to run Claude (don't break)

// If Claude makes changes during verification, reset:
if (pushSucceeded) {
  finalVerificationDone = false
}
```

Claude's final verification iteration:
1. Runs `bun run typecheck`
2. Runs `bun test`
3. Runs `bun run build` (if build script exists)
4. If any fail, fixes issues, commits, and pushes

This ensures the PR only becomes ready when all tests, typecheck, and build pass.

## Step Mode

Pause after each iteration for tuning and review. Useful for observing Claude's behavior and adjusting prompts.

### Enabling Step Mode
- **CLI**: `bun ralph.ts --step features.json`
- **Dashboard**: Toggle "Step" checkbox at runtime

### Post-Iteration Checkpoint
After Claude completes and commits are pushed:
1. If step mode enabled → set `paused = true`
2. Show CLI prompt: `[c]ontinue, [s]top`
3. Wait for user input OR dashboard resume
4. Continue or break based on response

```typescript
if (shouldStep && !once) {
  console.log("Step mode: Iteration complete")
  // Wait for CLI input or dashboard resume
  const action = await promptForAction()
  if (action === "stop") break
}
```

## Signal Handling

Immediate shutdown via Ctrl+C or dashboard stop button.

### Shutdown Flow
1. First SIGINT/SIGTERM → set `stopping = true`, abort Claude process immediately
2. Second signal → force exit immediately
3. Always run cleanup (container removal) in finally block

### Abort Controller
Claude process can be terminated immediately via abort controller:
```typescript
let claudeAbortController: AbortController | null = null

// When stop requested (signal or dashboard)
claudeAbortController?.abort()  // Kills Claude immediately
```

### State Variables
```typescript
let shutdownRequested = false  // CLI signal received

// In signal handler:
if (shutdownRequested) {
  process.exit(1)  // Force exit on second signal
}
shutdownRequested = true
setStopping(true)  // Update dashboard state
```

## Configuration

### CLI Arguments
See `src/args.ts` for parsing logic.

| Argument | Default | Description |
|----------|---------|-------------|
| `[features.json]` | `.ralph/features.json` | Path to features file |
| `--branch <name>` | `ralph/MMDD-HHMM-{feature}` | Resume existing branch |
| `--once` | `false` | Run single iteration only |
| `--max-iterations <n>` | `50` | Maximum loop iterations |
| `--step` | `false` | Pause after each iteration for review |
| `--dashboard` | `false` | Enable web dashboard |
| `--dashboard-port <n>` | `3847` | Dashboard server port |

### Branch Naming

Auto-generated branch names follow the format: `ralph/MMDD-HHMM-{feature-slug}`

- `MMDD` - Month and day (e.g., `0114` for January 14th)
- `HHMM` - Hour and minute in 24h format (e.g., `1435` for 2:35 PM)
- `{feature-slug}` - First feature ID, truncated to 25 characters

**Examples:**
- `ralph/0114-1435-add-login-button`
- `ralph/0115-0930-implement-dark-mode`

This format makes branches easy to sort chronologically while showing what each session is working on.

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
- `/workspace/.ralph/features.json` - Feature completion status
- `/workspace/.git/` - Git history and branches
- `/workspace/ralph-progress.txt` - Claude's learning notes
- `/workspace/.ralph-prompt.md` - Current iteration instructions

### Dashboard State (optional)
Managed by `src/server.ts`, broadcast via SSE:
```typescript
interface DashboardState {
  paused: boolean
  running: boolean
  stepMode: boolean      // Pause after each iteration
  stopping: boolean      // Graceful shutdown requested
  claudeRunning: boolean // Claude process currently active
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
