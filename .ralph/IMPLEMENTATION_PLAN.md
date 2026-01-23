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
- Note: parseNDJSON has comprehensive tests; other utilities (parseNDJSONWithFallback, fromReadableStream, collectAll, forEach) have no dedicated tests

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
  - main.ts:29-30 - Comment says "placeholder" with hardcoded `ralph-session-placeholder`
  - main.ts:38-50 - Hardcoded `placeholderState` object with empty defaults
  - main.ts:56-58 - Calls mainLoop with placeholders instead of real session
  - Production flow: parseArgs → validateEnvironment → createSession → mainLoop → cleanup
  - Reference working flow in ralph.ts:349-400 for expected pattern
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
- [ ] Validate required environment on startup (refs: specs/orchestrator.md:197-203, src/layers/ConfigLive.ts:35-47)
  - `CLAUDE_CODE_OAUTH_TOKEN` - Required, error if missing
  - Add `ANTHROPIC_API_KEY` fallback (ralph.ts:358 accepts either, ConfigLive:35 only checks OAuth)
  - `GITHUB_TOKEN` - Auto-detect via `gh auth token` if not set (ralph.ts:161, missing in ConfigLive:45)
  - Validate before starting container to fail fast
  - Clear error messages for missing credentials

### 1.7 --once Flag Handling
- [ ] Implement single-iteration mode (refs: src/args.ts:26, src/program.ts:283-335)
  - `--once` flag parsed but not wired to mainLoop
  - When enabled, run exactly one iteration then exit
  - Should still respect circuit breaker and cleanup

### 1.8 maxIterations Enforcement
- [ ] Enforce max iteration limit in mainLoop (refs: src/args.ts:7, src/program.ts:295-297)
  - `maxIterations` parsed at args.ts:35-37 but never checked in loop
  - Add to loop condition: `state.iteration < maxIterations`
  - Currently circuit breaker (3 no-change) is only exit besides feature completion

### 1.9 Startup Cleanup (Moved from P4.4)
- [ ] Clean up stale containers on startup (refs: specs/orchestrator.md:10-21, ralph.ts:136-142)
  - **CRITICAL**: Must run BEFORE createSession() per spec
  - Implement `cleanupStaleContainers()` function
  - Use DockerService.listByPrefix("ralph-") to find orphaned containers
  - Remove stale containers before starting new session
  - Add to main.ts startup sequence, not createSession

### 1.10 Container Health Checks
- [ ] Implement ensureContainerRunning() function (refs: specs/orchestrator.md:28, ralph.ts:144-152)
  - Called at start of each iteration before running Claude
  - Use DockerService.inspect() to check container state
  - Auto-restart with DockerService.start() if stopped
  - Fail iteration if container cannot be restarted

### 1.11 Branch Name Generation
- [ ] Implement branch naming for new sessions (refs: specs/orchestrator.md branch naming, ralph.ts:50-68)
  - Build mode: `ralph/MMDD-HHMM-{feature-slug}` pattern
  - Plan mode: `ralph/MMDD-HHMM-plan` pattern
  - Functions exist in ralph.ts:50-68 as reference
  - Wire to createSession() for non-resume sessions

### 1.12 Features.json Copying (Build Mode)
- [ ] Copy features.json to container for build mode (refs: ralph.ts:217-227)
  - Skip for plan mode (uses .ralph-prompt.md instead)
  - Ensure .ralph directory exists in container
  - Use DockerService.writeFile() or copyToContainer()
  - Required before first iteration in build mode

### 1.13 Resume vs New Session Logic
- [ ] Implement branch resume detection (refs: ralph.ts:381-397)
  - Check if --branch specified
  - Verify branch exists on remote: `git ls-remote --heads origin ${branch}`
  - Set isResume flag for checkout vs create logic
  - Error if specified branch doesn't exist on remote
  - Different flow: resume → checkout existing, new → create branch

### 1.14 Plan Mode Completion Detection
- [ ] Detect when planning is complete (refs: ralph.ts:613-626)
  - After each iteration in plan mode, check:
    1. PR exists: `gh pr view HEAD --json url`
    2. No unpushed commits: compare origin/branch..HEAD
  - If both true, Claude is signaling completion → exit gracefully
  - Different from build mode completion (feature-based)

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

### 2.5 Interactive CLI Prompts (Step Mode)
- [ ] Implement CLI prompt for step mode without dashboard (refs: ralph.ts:106-132)
  - `promptForAction()` function for async stdin/stdout interaction
  - After each iteration when stepMode enabled and NOT using dashboard
  - Show prompt: `[c]ontinue, [s]top` with default continue on empty
  - Race CLI input against dashboard resume when both active
  - Required for step-by-step debugging without browser

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

### 4.1 Git Error Recovery
- [ ] Improve git operation error handling (refs: src/layers/GitLive.ts)
  - Handle merge conflicts gracefully
  - Retry transient failures
  - Better error messages for common issues

### 4.2 Timeout Handling Improvements
- [ ] Add progress-aware timeout (refs: specs/claude-integration.md:132-142)
  - Currently uses fixed 10-minute timeout
  - Extend timeout if Claude is making progress (streaming events)
  - Add configurable timeout via CLI

### 4.3 Error Recovery with Retry Logic
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

### 5.5 Stream Utility Tests
- [ ] Add tests for remaining ndjson.ts utilities (refs: src/streams/ndjson.ts:41-101)
  - `parseNDJSONWithFallback()` - discriminated union return, mixed JSON/text handling
  - `fromReadableStream()` - WHATWG ReadableStream conversion
  - `collectAll()` - stream-to-array collection
  - `forEach()` - side-effect iteration
  - Currently only `parseNDJSON()` has comprehensive tests

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

### Dual Orchestration Implementations (Critical)
- Legacy: `/workspace/ralph.ts` - Active, used in production, ~650 lines
  - Has working: signal handling, firewall detection, step mode, event streaming, CLI prompts
  - Has working: branch generation, features.json copying, resume logic, plan mode completion
  - Uses: Bun.spawn, Bun.$, direct process management
- Effect-based: `/workspace/src/main.ts` + `/workspace/src/program.ts` - In development
  - Has working: service interfaces, layer composition, test infrastructure
  - Missing: wiring to createSession, cleanup, signal handling, step mode
  - Missing: branch generation, features copying, resume logic, plan completion detection
- The Effect implementation needs to replicate all working features from ralph.ts
- **Migration Strategy**: ralph.ts serves as working reference for all P1 features

### Branch Naming Logic Exists
- `generateContainerName()` in `/workspace/src/container.ts` generates timestamps
- Pattern available but not wired to main.ts branch creation
- Container naming uses `ralph-session-{timestamp}` pattern

### CLI Args Parsed but Not Used
- `--once` flag parsed at src/args.ts:33-34 but not checked in mainLoop (see P1.7)
- `stepMode` parsed at src/args.ts:40 but not integrated with iteration pause logic (see P2.3)
- `maxIterations` parsed at src/args.ts:35-37 but loop condition at program.ts:295-297 doesn't check it (see P1.8)

### Model Always Hardcoded to Opus
- ClaudeLive.ts lines 27 and 76 always use `claude-opus-4-5-20251101`
- No CLI flag to override model selection
- Consistent with specs but worth noting for future flexibility

### Missing Test Coverage Areas
- 0% coverage on service layer implementations (~931 lines total):
  - DockerLive.ts: 324 lines
  - ClaudeLive.ts: 137 lines
  - GitLive.ts: 140 lines
  - ConfigLive.ts: 67 lines
  - DashboardLive.ts: 216 lines
  - layers/index.ts: 47 lines
- 0% coverage on createSession() function (177 lines, critical path)
- 0% coverage on dashboard server endpoints (server.ts, 300 lines)
- 0% coverage on main.ts entry point (69 lines)
- No integration tests for full orchestration lifecycle
- ~59% coverage on ndjson.ts (parseNDJSON tested, 4 other utilities untested)
- Test-to-code ratio: ~54% (1,260 test lines / 2,351 source lines)
- Currently tested: args, container, errors, program logic (with mocks), parseNDJSON

### Hardcoded Values Requiring Attention
- Claude model: `"claude-opus-4-5-20251101"` hardcoded in ClaudeLive.ts (lines 27, 76)
- Config timeout: `5 * 60 * 1000` ms hardcoded in ConfigLive.ts (line 60)
- Claude operation timeout: `10 * 60 * 1000` ms hardcoded in program.ts (line 244)
- Firewall wait: `"3 seconds"` hardcoded in program.ts (line 75)
- Circuit breaker threshold: `3` iterations hardcoded in program.ts (lines 297, 324, 328)
- Docker image: `"ralph-base:latest"` hardcoded in program.ts (line 34)
- All paths assume `process.env.HOME` exists and has `.ssh` and `.claude` directories

---

## Blockers

### None Currently Identified
- All dependencies are internal
- No external service integrations pending
- Docker base image and firewall scripts are complete

---

## Implementation Notes

### ZFC Compliance (Critical Design Principle)
Per specs/zfc-architecture.md, the orchestrator must remain a "thin, safe, deterministic shell":
- All reasoning delegated to Claude
- Orchestrator handles only IO, plumbing, and policy enforcement
- No heuristic decision-making in orchestrator code

**Allowed Operations**:
- Pure IO: Read/write files, execute Docker commands, parse/serialize structured data
- Structural validation: JSON schema validation, required fields checks
- Policy enforcement: Max iterations budget, circuit breaker (3 no-change), timeout enforcement
- Mechanical transforms: Parameter substitution, CLI parsing, NDJSON stream parsing
- State management: Iteration tracking, progress monitoring, dashboard state updates
- Typed error handling: Use `_tag` discriminated unions, handle via `Effect.catchTag()`

**Forbidden Operations**:
- No ranking/scoring/selection: Cannot choose features based on complexity heuristics
- No semantic analysis: Cannot infer meaning from text content or keyword matching
- No heuristic classification: Cannot route based on keywords like "done", "complete", "error"
- No quality judgment: Cannot reject commits based on code quality scores
- No pattern matching on AI output: Must use structured data (features.json) or exit codes

### Branch Naming Convention
`ralph/MMDD-HHMM-{feature-slug}` per specs/orchestrator.md

### CI Gate Requirement (Critical)
Per specs/features.md and specs/orchestrator.md, Claude must run full CI suite before marking ANY feature as `passes: true`:
1. `bun run typecheck` (or project equivalent)
2. `bun test` (or project equivalent)
3. `bun run build` (if build script exists)
4. Feature's `verify_command` (if present)

**Rules (ZFC-compliant, enforced by Claude)**:
- Claude CANNOT mark `passes: true` until ALL checks pass
- Claude CANNOT commit until ALL checks pass
- Claude CANNOT move to next feature until ALL checks pass
- If CI fails, Claude must fix issues and rerun CI

### Phased Implementation for Logging (per specs/logging-telemetry.md:300-330)
- Phase 1: LoggingService with JSONL append, iteration boundaries, recovery endpoints
- Phase 2: Iteration sidebar with metrics, click to load, status indicators
- Phase 3: Activity log improvements (expand, highlight, prompt display)
- Phase 4: Subagent tracking (Task tool timing)
- Phase 5: Prompt editing and re-run functionality

### Priority Summary
| Priority | Category | Items | Status |
|----------|----------|-------|--------|
| P1 | Critical Integration | 14 items | Blocking basic functionality |
| P2 | Dashboard Integration | 5 items | Core UX features |
| P3 | Missing Functionality | 5 items | Logging/telemetry subsystem |
| P4 | Robustness | 4 items | Production readiness |
| P5 | Test Coverage | 5 items | Quality assurance |

### Dependency Graph
```
P1.9 Startup Cleanup ─────► P1.1 Main Entry Point (cleanup runs FIRST)
                                  │
P1.6 Environment Validation ──────┤
                                  │
                                  ├─► P1.10 Container Health Checks
                                  │
                                  ├─► P1.11 Branch Name Generation
                                  │         │
                                  │         └─► P1.13 Resume vs New Session
                                  │
                                  ├─► P1.12 Features.json Copying (build mode)
                                  │
                                  ├─► P1.2 Firewall Ready Detection
                                  │
                                  ├─► P1.3 copyToContainer (optional, for bulk ops)
                                  │
                                  ├─► P1.4 Final Verification Logic
                                  │
                                  ├─► P1.5 Signal Handling
                                  │
                                  ├─► P1.7 --once Flag Handling
                                  │
                                  ├─► P1.8 maxIterations Enforcement
                                  │
                                  └─► P1.14 Plan Mode Completion Detection

P2.* Dashboard ────────────► Requires P1.1 complete first
     │
     └─► P2.5 Interactive CLI Prompts (can test without dashboard)

P3.* Logging ──────────────► Can proceed in parallel with P2

P4.* Robustness ───────────► After P1-P3 complete

P5.* Testing ──────────────► After each priority phase
```
