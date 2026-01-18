# Orchestrator Specification

**Files**: `src/main.ts` (entry point), `src/program.ts` (orchestration logic)
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

Uses `DockerService.listByPrefix("ralph-")` to find existing containers and `DockerService.remove()` to clean them up. See `CLAUDE.md` for service implementation details.

### `ensureContainerRunning(containerName: string)`
Health check with automatic restart.

Uses `DockerService.inspect()` to check container state and `DockerService.start()` if not running.

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

**Container configuration includes:**
- `CAP_NET_ADMIN` capability for firewall setup
- Environment variables from ConfigService (CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN)
- SSH volume mounts for git operations

### `runClaudeInContainer(containerName: string, prompt: string)`
Executes Claude with timeout and output streaming.

Uses `ClaudeService.runWithEvents()` which:
- Builds the Claude CLI command with flags (--output-format stream-json, --verbose, etc.)
- Streams NDJSON events via Effect Stream for automatic cleanup
- Applies timeout via `Effect.timeout()` producing a `TimeoutError` if exceeded
- Returns a stream of typed ClaudeEvent objects

## Circuit Breaker Logic

Prevents infinite loops when Claude gets stuck.

**Behavior**: After each iteration, if `GitService.hasUnpushedCommits()` returns false, increment `noChangeCount`. After 3 consecutive iterations without git changes, abort with `CircuitBreakerError`.

The circuit breaker state is tracked via `Effect.iterate()` in `program.ts`, which manages iteration state immutably. On successful push, `noChangeCount` resets to 0.

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

**Behavior**: Track `finalVerificationDone` in iteration state. First time all features pass, run Claude for final verification. If Claude makes and pushes changes, reset the flag. Second time all features pass without new changes, mark PR ready and exit.

Claude's final verification iteration:
1. Runs `bun run typecheck`
2. Runs `bun test`
3. Runs `bun run build` (if build script exists)
4. If any fail, fixes issues, commits, and pushes

This ensures the PR only becomes ready when all tests, typecheck, and build pass.

## Step Mode

Pause after each iteration for tuning and review. Useful for observing Claude's behavior and adjusting prompts.

### Enabling Step Mode
- **CLI**: `bun src/main.ts --step features.json`
- **Dashboard**: Toggle "Step" checkbox at runtime

### Post-Iteration Checkpoint
After Claude completes and commits are pushed:
1. If step mode enabled → set `paused = true` via `DashboardService.updateState()`
2. Show CLI prompt: `[c]ontinue, [s]top`
3. Wait for user input OR dashboard resume
4. Continue or break based on response

## Signal Handling

Immediate shutdown via Ctrl+C or dashboard stop button.

### Shutdown Flow
1. First SIGINT/SIGTERM → set `stopping = true`, abort Claude process immediately
2. Second signal → force exit immediately
3. Always run cleanup (container removal) in finally block

### Abort Mechanism
The ClaudeService supports interruption via Effect's interruption model. When stop is requested (signal or dashboard), the current Claude execution is interrupted, allowing cleanup to proceed.

Dashboard state is updated via `DashboardService.updateState({ stopping: true })` to reflect shutdown status.

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

### Orchestrator State
Iteration state is managed immutably via `Effect.iterate()` in `program.ts`:
- `iteration` - Current iteration count
- `noChangeCount` - Consecutive iterations without git changes
- `containerName` - Active container identifier

### Persistent State (container filesystem)
- `/workspace/.ralph/features.json` - Feature completion status
- `/workspace/.git/` - Git history and branches
- `/workspace/ralph-progress.txt` - Claude's learning notes
- `/workspace/.ralph-prompt.md` - Current iteration instructions

### Dashboard State
Managed by `DashboardService` using Effect `Ref` for thread-safe, immutable updates. State is broadcast to connected clients via SSE. See `CLAUDE.md` for DashboardState interface.

## Error Handling

Errors use Effect's typed error channels with `Effect.catchTag` for pattern matching:

### Fatal Errors (exit immediately)
- `ConfigError` - Missing CLAUDE_CODE_OAUTH_TOKEN or not in git repo
- `FeatureError` - Invalid or missing features.json
- `CircuitBreakerError` - 3 iterations without changes

### Recoverable Errors (retry or continue)
- `DockerError` - Retry container operations with backoff
- `TimeoutError` - Increment noChangeCount, continue to next iteration
- `GitError` - Log and continue (push failures don't abort)

See `CLAUDE.md` for complete error type definitions.

## Integration Points

| Component | Integration |
|-----------|-------------|
| Container | `DockerService.create()`, `DockerService.start()`, `DockerService.exec()` |
| Features | Read via `DockerService.readFile()`, parsed by `getRemainingFeatures()` |
| Claude | `ClaudeService.runWithEvents()` with NDJSON streaming |
| Dashboard | `DashboardService.updateState()`, `DashboardService.broadcast()` |
| Git | `GitService.checkout()`, `GitService.push()`, `GitService.hasUnpushedCommits()` |
