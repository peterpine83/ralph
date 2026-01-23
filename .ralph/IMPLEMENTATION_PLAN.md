# Implementation Plan

## Completed

- [x] Service architecture fully implemented (Config, Docker, Claude, Git, Dashboard)
- [x] Layer implementations complete with Effect.ts patterns
- [x] Error handling system with 10 custom error types
- [x] Stream utilities for NDJSON parsing
- [x] Container utility functions (name generation, parsing)
- [x] CLI argument parsing with all flags
- [x] Test coverage (80 tests passing, 142 assertions)
- [x] TypeScript compilation (zero errors)
- [x] Core orchestration logic (createSession, runIteration, mainLoop)

## Priority 1: Critical - Make It Run (Production Entry Point)

### Main Entry Point Implementation
- [ ] **Fix main.ts to call createSession** (refs: src/main.ts:17-64, specs/orchestrator.md)
  - CONFIRMED: main.ts is a placeholder stub (line 17: "NOTE: This is a placeholder implementation")
  - Remove placeholder values (containerName, prompt, state at lines 29-46)
  - Read `templates/ralph-instructions.md` and write to container's `.ralph-prompt.md`
  - Call createSession() to initialize container (function exists in program.ts)
  - Build MainLive layer with actual runtime values from createSession result
  - Sequence: args → config → createSession → mainLoop
  - Proper error handling without `as Effect.Effect<void, never, never>` workaround (line 63)

- [ ] **Implement features.json initialization** (refs: specs/features.md, src/args.ts:17)
  - CONFIRMED: Code fully supports features.json (19 file references found)
  - Default path: `.ralph/features.json` (can override via CLI)
  - Test example exists at `/workspace/test-features.json`
  - Check if features.json exists at specified path (from args.featuresPath)
  - If missing, fail with helpful error: "Features file not found at {path}. See test-features.json for example format."
  - Pass features path through SessionConfig
  - Copy features.json to container during createSession (already implemented in ralph.ts:208-213)

- [ ] **Integrate dashboard with main orchestration loop** (refs: specs/dashboard.md, src/layers/DashboardLive.ts)
  - Start dashboard server before main loop (if --dashboard flag)
  - Update dashboard state at each iteration:
    - Broadcast iteration progress
    - Broadcast feature status changes
    - Stream Claude events to dashboard
  - Hook pause/resume/step controls to main loop
  - Shutdown dashboard cleanly on exit

- [ ] **Remove legacy server.ts** (refs: src/server.ts, src/layers/DashboardLive.ts)
  - CONFIRMED: server.ts is UNUSED legacy code (zero imports in codebase)
  - DashboardLive.ts is the ACTIVE Effect-based implementation
  - server.ts uses imperative style with mutable global state (pre-Effect architecture)
  - DashboardLive.ts properly integrated in MainLive layer (src/layers/index.ts)
  - DECISION: **Remove src/server.ts entirely** - it's duplicate legacy code
  - Keep DashboardLive.ts and DashboardTest.ts

## Priority 2: High - ZFC Compliance & Orchestrator Specs

### Session Management
- [ ] **Implement proper firewall readiness detection** (refs: src/program.ts:72, specs/container.md)
  - Replace `Effect.sleep("3 seconds")` with log streaming
  - Use docker.execStream to capture container logs
  - Parse for "Ralph Firewall Ready" message
  - Timeout after 10 seconds if message not detected

- [ ] **Add cleanup for stale containers** (refs: specs/orchestrator.md)
  - Implement `cleanupStaleContainers()` function
  - Call before createSession in main.ts
  - Use docker.listByPrefix to find old ralph-* containers
  - Remove containers older than session

- [ ] **Add container health check** (refs: specs/orchestrator.md)
  - Implement `ensureContainerRunning()` function
  - Check container state via docker.inspect
  - Auto-restart if container stopped mid-iteration
  - Call before each runIteration

### Iteration Control
- [ ] **Implement max iterations limit** (refs: specs/orchestrator.md)
  - Add maxIterations check to mainLoop while condition
  - Currently only checks circuit breaker (noChangeCount)
  - Should also exit when iteration >= config.maxIterations
  - Proper error message when limit reached

- [ ] **Implement --once flag behavior** (refs: src/args.ts, specs/orchestrator.md)
  - Parse flag correctly (already done in args.ts)
  - Pass to mainLoop configuration
  - Exit after first iteration if --once is true
  - Override maxIterations when --once set

- [ ] **Implement --step flag behavior** (refs: src/args.ts, specs/orchestrator.md, specs/dashboard.md)
  - Parse flag correctly (already done in args.ts)
  - Pass to DashboardService initial state
  - Pause after each iteration when stepMode enabled
  - Wait for /resume POST before continuing
  - Display "Paused - waiting for resume" message

### Final Verification
- [ ] **Implement final verification run** (refs: specs/orchestrator.md)
  - After all features pass, run one final Claude iteration
  - Prompt: "All features complete. Run final verification: bun run typecheck && bun test && bun run build"
  - Ensure entire project still works after all changes
  - Exit with success if verification passes

## Priority 3: Medium - Missing Implementation Details

### Docker Operations
- [ ] **Implement DockerService.copyToContainer** (refs: src/services/Docker.ts:111, src/layers/DockerLive.ts)
  - Currently returns `dieMessage("Not implemented yet")`
  - May be needed for copying features.json to container
  - Alternative: use docker.writeFile for simple file copy
  - Or use docker exec with cat/heredoc

### Git Operations
- [ ] **Add git user configuration** (refs: specs/orchestrator.md)
  - GitService.configureUser already exists
  - Call during createSession after cloning
  - Read from config: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL
  - Default to "Ralph Bot <ralph@anthropic.com>"

- [ ] **Handle merge conflicts gracefully** (refs: specs/orchestrator.md)
  - If git push fails with merge conflict
  - Run git fetch + git pull --rebase
  - Retry push with upstream
  - Fail iteration if conflict persists

### Claude Integration
- [ ] **Stream Claude events to dashboard** (refs: specs/claude-integration.md, specs/dashboard.md)
  - Use ClaudeService.runWithEvents instead of run
  - Parse NDJSON stream events (already implemented in ClaudeLive)
  - Broadcast each event via DashboardService.broadcast
  - Show real-time Claude activity in dashboard UI

- [ ] **Add Claude process abort on /stop** (refs: specs/dashboard.md, src/server.ts:258)
  - DashboardService needs killClaude method
  - Store Claude process handle in service state
  - POST /stop should kill running Claude process
  - Clean up container state after abort

### Configuration
- [ ] **Add helpful error for missing CLAUDE_CODE_OAUTH_TOKEN** (refs: src/layers/ConfigLive.ts)
  - Currently fails with generic "required" message
  - Provide instructions: "Set CLAUDE_CODE_OAUTH_TOKEN=... or run: export CLAUDE_CODE_OAUTH_TOKEN=$(claude auth print-token)"
  - Include link to Claude Code setup docs

- [ ] **Auto-generate branch name if not provided** (refs: specs/orchestrator.md, src/args.ts)
  - Format: `ralph/MMDD-HHMM-{feature-slug}`
  - Extract first feature ID from features.json as slug
  - Generate timestamp in local timezone
  - Example: `ralph/0123-1430-setup-project`

## Priority 4: Low - Code Quality & Polish

### Type Safety
- [ ] **Remove `as any` workarounds** (refs: src/layers/ClaudeLive.ts:129, src/layers/GitLive.ts:138, src/layers/DashboardLive.ts:188)
  - Documented as Context.Tag shadowing issue
  - See ralph-progress.txt effect-020 notes
  - May require upstream Effect.ts fix or different pattern
  - Low priority - currently works correctly

### Testing
- [ ] **Add integration tests for main.ts** (refs: src/main.ts)
  - Test full orchestration flow with test containers
  - Mock DockerService for unit tests
  - Test error paths (missing config, container failures)

- [ ] **Add tests for createSession** (refs: src/program.ts)
  - Test container creation sequence
  - Test git clone and branch setup
  - Test firewall readiness detection (after implementing)

### Documentation
- [ ] **Add inline comments to main.ts** (refs: src/main.ts)
  - Explain orchestration flow
  - Document error handling strategy
  - Add examples of proper usage

- [ ] **Update README with usage examples** (refs: /workspace/README.md)
  - Show how to run Ralph with flags
  - Document environment variables
  - Include troubleshooting guide

## Discoveries

### Main Entry Point Status (CRITICAL FINDING)
- **src/main.ts is explicitly marked as placeholder** (line 17: "NOTE: This is a placeholder implementation")
- All infrastructure is COMPLETE and working:
  - ✅ createSession() in program.ts - Creates and initializes container
  - ✅ runIteration() in program.ts - Runs single orchestration loop
  - ✅ mainLoop() in program.ts - Implements Effect.iterate with circuit breaker
  - ✅ parseArgs() in args.ts - CLI argument parsing with all flags
  - ✅ All services (Docker, Claude, Git, Config, Dashboard) fully implemented
  - ✅ All layers with proper Effect composition
  - ✅ 80 tests passing, zero TypeScript errors
- Main.ts needs complete rewrite to connect all the working pieces
- Current issues:
  - Hard-coded containerName: "ralph-session-placeholder" (line 31)
  - Hard-coded prompt string (line 35)
  - Dummy dashboard state (lines 37-44)
  - Type cast workaround `as Effect.Effect<void, never, never>` (line 63)
  - No createSession call, no dashboard integration, no features.json validation

### Existing Standard Library (src/)
- Found comprehensive Effect.ts-based architecture
- All services use Context.Tag pattern with Layer factories
- Stream utilities handle NDJSON parsing with fallback
- Error system has 10 typed errors with catchTag support
- Container utilities parse docker/git output correctly
- **Extend these patterns** - do not rewrite

### Duplicate Dashboard Implementation (RESOLVED)
- DashboardLive.ts (Effect-based, immutable state via Ref) - ✅ ACTIVE, used in MainLive
- server.ts (imperative, mutable global state) - ❌ LEGACY, zero imports, should be removed
- DECISION: Remove server.ts entirely - it's unused pre-Effect code
- Both files implement identical functionality (SSE streaming, state management, pause/resume)
- DashboardLive.ts is properly tested via DashboardTest.ts mock layer

### Template System (CLARIFIED)
- **Feature Implementation Template**: `/workspace/templates/ralph-instructions.md` ✅
  - Used during normal orchestrator execution (implementing features)
  - Contains rules: one feature per iteration, EXIT immediately, verify with CI
  - Written to container's `.ralph-prompt.md` before Claude invocation
  - Referenced in ralph.ts:474-484 and src/main.ts:31
- **Planning Mode Template**: `/workspace/.ralph-prompt.md` ✅
  - Used when generating implementation plans (current mode)
  - Contains rules: research codebase, identify gaps, generate plan, no implementation
  - Creates `.ralph/IMPLEMENTATION_PLAN.md` output
- Both templates use same invocation pattern: `claude "Read .ralph-prompt.md and follow the instructions."`

### Features Configuration (FULLY SUPPORTED)
- `.ralph/features.json` is currently MISSING from workspace (expected - user provides it)
- Code is FULLY READY for features.json (found 19 file references):
  - ralph.ts:208-213 - Copies from git root to container
  - src/main.ts:20,359 - Reads and parses features array
  - src/program.ts:223 - Reads from container during iterations
  - src/args.ts:17,44 - Default path `.ralph/features.json`, CLI override supported
  - specs/features.md - Complete schema specification
  - templates/ralph-instructions.md:15-32 - Claude instructions to read/process features.json
- Test example exists at `/workspace/test-features.json` showing exact format
- Schema: `{ features: [{ id, description, passes, verify_command }] }`
- Not a blocker - user will provide when running Ralph

### Test Coverage Status
- 80 tests passing (args, container, errors, streams, program)
- Zero TypeScript errors
- No tests yet for main.ts entry point
- Missing integration tests for full orchestration flow

## Blockers

None currently. All dependencies are in place:
- Effect.ts and platform packages installed
- Docker service implementation complete
- Claude Code CLI available in container
- Git operations working
- All specs documented

## What's Working vs What's Missing

### ✅ Working Infrastructure (Do NOT rewrite)
- All 5 services fully implemented (Config, Docker, Claude, Git, Dashboard)
- All Effect layers with proper Context.Tag pattern
- createSession() orchestration (creates container, waits for firewall, clones repo)
- runIteration() orchestration (runs Claude, parses output, updates features)
- mainLoop() with circuit breaker (stops after 3 no-change iterations)
- CLI argument parsing with all flags
- Error handling system (10 custom error types with catchTag)
- Stream utilities for NDJSON parsing
- Container utilities (name generation, output parsing)
- 80 passing tests, zero TypeScript errors
- Template files (ralph-instructions.md for features, .ralph-prompt.md for planning)

### ❌ Missing/Incomplete (Priority 1-2 tasks)
- **main.ts production implementation** - Currently placeholder stub
- **Dashboard integration** - DashboardLive exists but not connected to main loop
- **Features.json validation** - Code supports it but main.ts doesn't validate
- **Template loading** - templates/ralph-instructions.md not loaded in main.ts
- **Firewall readiness detection** - Uses sleep instead of log streaming (program.ts:72-73)
- **Container cleanup** - No stale container removal before session
- **Container health checks** - No validation before each iteration
- **Iteration limits** - maxIterations not enforced in mainLoop
- **--once and --step flags** - Parsed but not implemented
- **Final verification** - No final CI run after all features complete
- **server.ts removal** - Legacy unused code should be deleted

## Implementation Order Recommendation

1. **Start with Priority 1** - Make the entry point work
   - Rewrite main.ts to use real createSession (remove placeholder values)
   - Load templates/ralph-instructions.md and validate features.json exists
   - Integrate dashboard startup (conditional on --dashboard flag)
   - Remove legacy server.ts (zero imports, unused)

2. **Then Priority 2** - Complete orchestrator compliance
   - Firewall readiness detection (replace Effect.sleep with log streaming)
   - Container cleanup and health checks (before session, before each iteration)
   - Iteration limits (maxIterations, --once, --step flags)
   - Final verification run (when all features.passes === true)

3. **Then Priority 3** - Fill implementation gaps
   - Stream Claude events to dashboard (use runWithEvents instead of run)
   - Handle git conflicts (fetch + pull --rebase on push failure)
   - Better error messages (CLAUDE_CODE_OAUTH_TOKEN, features.json not found)
   - Auto-generate branch names (ralph/MMDD-HHMM-{feature-slug})

4. **Finally Priority 4** - Polish
   - Remove `as any` workarounds (Context.Tag shadowing issue)
   - Add integration tests (main.ts, createSession)
   - Documentation (inline comments, README usage examples)

## Success Criteria

When all Priority 1 and Priority 2 items complete:
- ✅ `bun run src/main.ts --dashboard` starts successfully
- ✅ Dashboard shows at http://localhost:3847
- ✅ Ralph creates container, reads features.json, runs Claude
- ✅ Circuit breaker triggers after 3 no-change iterations
- ✅ Max iterations respected
- ✅ --once and --step flags work correctly
- ✅ Final verification runs when all features pass
- ✅ All existing tests still pass
- ✅ TypeScript compilation succeeds

This makes Ralph production-ready for autonomous feature implementation.
