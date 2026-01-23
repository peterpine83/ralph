# Implementation Plan

## Completed

### Effect Migration (Phase 5)
- [x] Error type tests and Stream tests
- [x] ConfigTest, DockerTest, ClaudeTest, GitTest, DashboardTest mock layers
- [x] TestLive layer composition
- [x] Program integration tests
- [x] ralph.ts updated as thin wrapper
- [x] CLAUDE.md documents Effect architecture
- [x] All tests pass, typecheck succeeds

### Core Services
- [x] ConfigService - Environment configuration with CLI args
- [x] DockerService - Container lifecycle management (create, start, remove, inspect, exec, readFile, writeFile, listByPrefix)
- [x] ClaudeService - Claude Code CLI integration with streaming events
- [x] GitService - Git operations (checkout, fetch, push, hasUnpushedCommits, createBranch, configureUser)
- [x] DashboardService - SSE server with state management

### Stream Processing
- [x] NDJSON parsing utilities (parseNDJSON, parseNDJSONWithFallback, fromReadableStream, collectAll, forEach)
- [x] Comprehensive error handling with StreamError

### Error Types
- [x] Tagged error types (ConfigError, DockerError, ContainerNotFoundError, ClaudeError, TimeoutError, GitError, FeatureError, CircuitBreakerError, StreamError, ValidationError)
- [x] Effect.catchTag integration

### CLI & Configuration
- [x] Argument parsing (--branch, --once, --max-iterations, --dashboard, --dashboard-port, --step, --mode)
- [x] Planning mode support (--mode plan)

---

## Priority 1: Critical Integration Gaps

### 1.1 Main Entry Point Integration
- [ ] Wire createSession() to main.ts (refs: src/main.ts:17-58, src/program.ts:23-200)
  - Currently uses placeholder values instead of actual session creation
  - Production flow: parseArgs → validateEnvironment → createSession → mainLoop → cleanup
  - Remove hardcoded `placeholderContainerName`, `placeholderPrompt`, `placeholderState`
  - Fix type annotation at line 67 (`as Effect.Effect<void, never, never>`)
  - Add cleanup in finally block (container removal via DockerService.remove())
  - Implement proper error handling with catchTags for fatal vs recoverable errors

### 1.2 Firewall Ready Detection
- [ ] Replace 3-second sleep with log streaming detection (refs: src/program.ts:74, docker/entrypoint.sh)
  - Detect "Ralph Firewall Ready" message from container logs
  - Use Docker logs streaming API or exec with log tail
  - Add timeout safety (fallback after 30s if message not detected)

### 1.3 copyToContainer Implementation
- [ ] Implement DockerLive.copyToContainer() (refs: src/layers/DockerLive.ts:290, src/services/Docker.ts:111-115)
  - Currently returns Effect.dieMessage("Not implemented yet")
  - Required for bulk file operations
  - Use `docker cp` command

### 1.4 Final Verification Logic
- [ ] Implement finalVerificationDone state and logic (refs: specs/orchestrator.md:125-138)
  - When all features marked `passes: true`, run one additional iteration
  - Track `finalVerificationDone` in iteration state
  - If Claude makes changes and pushes: Reset flag
  - Second time all pass without changes: Mark PR ready and exit

### 1.5 Signal Handling (SIGINT/SIGTERM)
- [ ] Implement graceful shutdown on signals (refs: specs/orchestrator.md:156-167)
  - First SIGINT/SIGTERM → set `stopping = true`, abort Claude immediately
  - Second signal → force exit immediately
  - Always run cleanup in finally block (container removal)
  - Update dashboard state to reflect shutdown status
  - Add signal handlers in main.ts before starting orchestration

### 1.6 Environment Variable Validation
- [ ] Validate required environment on startup (refs: specs/orchestrator.md:197-203)
  - `CLAUDE_CODE_OAUTH_TOKEN` - Required, error if missing
  - `GITHUB_TOKEN` - Auto-detect via `gh auth token` if not set
  - Validate before starting container to fail fast
  - Clear error messages for missing credentials

### 1.7 --once Flag Handling
- [ ] Implement single-iteration mode (refs: src/args.ts:26, src/program.ts:283-335)
  - `--once` flag parsed but not wired to mainLoop
  - When enabled, run exactly one iteration then exit
  - Should still respect circuit breaker and cleanup

---

## Priority 2: Dashboard Integration

### 2.1 Remove Legacy server.ts
- [ ] Migrate remaining functionality from server.ts to DashboardLive
  - server.ts uses global mutable state (lines 6-21)
  - DashboardLive uses Effect.Ref for state management
  - Consolidate to single implementation

### 2.2 Connect Dashboard to Effect Orchestration
- [ ] Integrate DashboardLive with mainLoop (refs: src/main.ts, src/server.ts, src/program.ts)
  - server.ts has standalone SSE server not connected to Effect services
  - DashboardService methods defined but not called from mainLoop
  - Wire iteration progress, feature status, Claude events to dashboard

### 2.3 Step Mode in Orchestration Loop
- [ ] Implement step mode pause/resume in mainLoop (refs: src/program.ts:283-335, src/types.ts:10-22)
  - stepMode flag exists in DashboardState and ConfigService
  - mainLoop needs to yield between iterations when stepMode enabled
  - Check `dashboard.getState().stepMode` at start of each iteration
  - Pause and wait for user input or dashboard resume

### 2.4 Prompt Template Editing
- [ ] Wire prompt template editing to mainLoop (refs: src/server.ts:266-280)
  - GET/PUT /prompt endpoints exist in server.ts
  - Not connected to actual prompt used in runIteration
  - Read template from DashboardState or file system

---

## Priority 3: Missing Functionality

### 3.1 ClaudeService.runWithEvents() Usage
- [ ] Use streaming events in mainLoop (refs: src/program.ts:241-251, src/services/Claude.ts:33-35)
  - Currently uses basic run() method
  - runWithEvents() returns ClaudeEvent stream
  - Enable real-time progress display and logging
  - Forward events to DashboardService for SSE broadcast

### 3.2 LoggingService Implementation
- [ ] Create LoggingService per specs/logging-telemetry.md
  - New service interface and layer
  - `appendEvent(event)` - Append to session JSONL file
  - `getIterationEvents(n)` - Read events for specific iteration
  - `getSessionPath()` - Return path to current session log
  - File format: `.ralph/sessions/{session-id}.jsonl`

### 3.3 JSONL Session Logging
- [ ] Wire LoggingService to Claude event stream (refs: specs/logging-telemetry.md:58-77)
  - Write Claude events to `.ralph/sessions/{session-id}.jsonl`
  - Add iteration boundary markers (`iteration_start` events)
  - Enable session replay and debugging

### 3.4 Iteration Metrics
- [ ] Track and display iteration metrics (refs: specs/logging-telemetry.md:79-111)
  - Extract from ClaudeResultEvent.message.usage
  - Token counts per iteration (input, output, total)
  - Context window percentage
  - Cost tracking (cost_usd)
  - Duration per iteration

### 3.5 New REST Endpoints
- [ ] Add recovery and iteration endpoints (refs: specs/logging-telemetry.md:260-285)
  - `GET /iterations` - Returns iteration list with metrics
  - `GET /logs/:iteration` - Returns raw JSONL for specific iteration
  - `POST /rerun` - Re-run iteration with modified prompt

---

## Priority 4: Robustness Improvements

### 4.1 Container Health Checks
- [ ] Implement proper container health monitoring
  - Currently basic running check via docker inspect
  - Add application-level health endpoints
  - Auto-recovery on container failures

### 4.2 Git Error Recovery
- [ ] Improve git operation error handling (refs: src/layers/GitLive.ts)
  - Handle merge conflicts gracefully
  - Retry transient failures
  - Better error messages for common issues

### 4.3 Timeout Handling Improvements
- [ ] Add progress-aware timeout (refs: specs/claude-integration.md:132-142)
  - Currently uses fixed 10-minute timeout
  - Extend timeout if Claude is making progress (streaming events)
  - Add configurable timeout via CLI

### 4.4 Startup Cleanup
- [ ] Clean up stale containers on startup (refs: specs/orchestrator.md:10-21)
  - Use DockerService.listByPrefix("ralph-") to find orphaned containers
  - Remove stale containers before starting new session
  - Add to createSession startup sequence

### 4.5 Error Recovery with Retry Logic
- [ ] Implement retry with exponential backoff for transient failures
  - Docker operations: network errors, daemon restarts
  - Git operations: remote connectivity, lock conflicts
  - Use Effect.retry with Schedule.exponential
  - Cap retries at 3 attempts with jitter

---

## Priority 5: Test Coverage Gaps

### 5.1 Service Layer Tests
- [ ] Add unit tests for DockerLive methods (refs: src/layers/DockerLive.ts)
  - Test create(), start(), remove(), inspect() with real Docker or testcontainers
  - Test exec() and execStream() output parsing
  - Test readFile() and writeFile() round-trip
  - Test copyToContainer() once implemented

### 5.2 Session Creation Tests
- [ ] Add tests for createSession() function (refs: src/program.ts:23-200)
  - Test container creation and startup sequence
  - Test git clone and repository setup
  - Test branch checkout logic (resume vs new)
  - Test firewall ready detection (once implemented)

### 5.3 Dashboard Server Tests
- [ ] Add tests for dashboard HTTP endpoints (refs: src/server.ts)
  - Test SSE client connection/disconnection
  - Test POST /pause, /resume, /step-mode, /stop
  - Test GET/PUT /prompt template operations
  - Test state broadcasting to multiple clients

### 5.4 Integration Test Suite
- [ ] Add end-to-end orchestration tests
  - Full session lifecycle: create → iterate → cleanup
  - Circuit breaker triggering after 3 no-change iterations
  - Feature completion detection
  - Signal handling (if practical to test)

---

## Discoveries

### Existing Utilities (src/lib equivalent)
- `/workspace/src/streams/ndjson.ts` - Comprehensive NDJSON parsing with error handling
- `/workspace/src/errors/index.ts` - Full suite of tagged error types
- `/workspace/src/container.ts` - Container name generation, feature parsing, git status parsing
- All utilities have comprehensive test coverage (110 tests total)

### Effect Patterns Already Established
- Context.Tag for dependency injection (all services)
- Layer composition with MainLive
- Tagged errors with Effect.catchTag
- Stream processing with Effect Stream
- Ref for mutable state management (DashboardLive)

### Test Infrastructure Ready
- TestLive layer with all mock services
- Integration tests for mainLoop and runIteration
- Unit tests for all utilities

### Type Workarounds
- `as any` used for Effect Context.Tag interface/class shadowing issue
- Documented in multiple layer files (ClaudeLive:135, GitLive:138, DashboardLive:188)
- 3 production instances, 28 test instances - consistent pattern

### Dual Dashboard Implementations
- Legacy: `/workspace/src/server.ts` - global mutable state, direct Bun.serve
- Effect-based: `/workspace/src/layers/DashboardLive.ts` - Effect.Ref, scoped lifecycle
- Need to consolidate to single implementation

### Branch Naming Logic Exists
- `generateContainerName()` in `/workspace/src/container.ts` generates timestamps
- Pattern available but not wired to main.ts branch creation
- Container naming uses `ralph-session-{timestamp}` pattern

### CLI Args Parsed but Not Used
- `--once` flag parsed at src/args.ts:26 but not checked in mainLoop
- `stepMode` parsed but not integrated with iteration pause logic
- `maxIterations` parsed but mainLoop doesn't respect it (uses circuit breaker instead)

### Model Always Hardcoded to Opus
- ClaudeLive.ts lines 27 and 76 always use `claude-opus-4-5-20251101`
- No CLI flag to override model selection
- Consistent with specs but worth noting for future flexibility

### Missing Test Coverage Areas
- 0% coverage on service layer implementations (DockerLive, ClaudeLive, GitLive)
- 0% coverage on createSession() function
- 0% coverage on dashboard server endpoints
- No integration tests for full orchestration lifecycle

---

## Blockers

### None Currently Identified
- All dependencies are internal
- No external service integrations pending
- Docker base image and firewall scripts are complete

---

## Implementation Notes

### ZFC Compliance
Per specs/zfc-architecture.md, the orchestrator must remain a "thin, safe, deterministic shell":
- All reasoning delegated to Claude
- Orchestrator handles only IO, plumbing, and policy enforcement
- No heuristic decision-making in orchestrator code

### Branch Naming Convention
`ralph/MMDD-HHMM-{feature-slug}` per specs/orchestrator.md

### CI Gate Requirement
Per specs/features.md, Claude must run full CI suite (typecheck, tests, build) before marking any feature as `passes: true`

### Phased Implementation for Logging (per specs/logging-telemetry.md:300-330)
- Phase 1: LoggingService with JSONL append, iteration boundaries, recovery endpoints
- Phase 2: Iteration sidebar with metrics, click to load, status indicators
- Phase 3: Activity log improvements (expand, highlight, prompt display)
- Phase 4: Subagent tracking (Task tool timing)
- Phase 5: Prompt editing and re-run functionality

### Priority Summary
| Priority | Category | Items | Status |
|----------|----------|-------|--------|
| P1 | Critical Integration | 7 items | Blocking basic functionality |
| P2 | Dashboard Integration | 4 items | Core UX features |
| P3 | Missing Functionality | 5 items | Logging/telemetry subsystem |
| P4 | Robustness | 5 items | Production readiness |
| P5 | Test Coverage | 4 items | Quality assurance |

### Dependency Graph
```
P1.1 Main Entry Point ─────┬─► P1.5 Signal Handling
     │                      │
     ├─► P1.2 Firewall Ready Detection
     │
     ├─► P1.3 copyToContainer (optional, for bulk ops)
     │
     ├─► P1.4 Final Verification Logic
     │
     ├─► P1.6 Environment Validation
     │
     └─► P1.7 --once Flag Handling

P2.* Dashboard ────────────► Requires P1.1 complete first

P3.* Logging ──────────────► Can proceed in parallel with P2

P4.* Robustness ───────────► After P1-P3 complete

P5.* Testing ──────────────► After each priority phase
```
