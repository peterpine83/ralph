# Implementation Plan

## Research Iteration Summary (Latest)

This iteration reconfirmed previous findings and added critical details:

### Key Confirmations
- ✅ **main.ts still placeholder** - No changes since last iteration, line 17 confirms stub status
- ✅ **server.ts still unused** - Zero imports found via comprehensive codebase search
- ✅ **All infrastructure working** - Services, layers, orchestration functions all complete

### New Critical Findings
- 🔴 **NO error handling for features.json** - JSON.parse has no try-catch, crashes on invalid structure
- 🔴 **Missing orchestrator functions** - cleanupStaleContainers(), ensureContainerRunning() don't exist
- 🔴 **No signal handlers** - SIGINT/SIGTERM not handled for graceful shutdown
- 🔴 **Iteration limits not enforced** - mainLoop while condition doesn't check maxIterations
- 🔴 **Final verification missing** - No logic for when all features complete

### Refined Task Details
- Added specific line numbers and file references for all tasks
- Clarified template loading: in-memory for main.ts, written to container in runIteration
- Identified timeout discrepancy: code uses 10 minutes, spec says 5 minutes
- Added implementation approaches for each missing function
- Documented architectural patterns for Effect-based solutions

### Priority 1 Focus (Make It Run)
Must rewrite main.ts to:
1. Validate features.json exists with proper error handling
2. Call createSession() to get real containerName
3. Initialize and update dashboard throughout execution
4. Remove placeholder values and type cast workarounds
5. Delete legacy server.ts

### Priority 2 Focus (Orchestrator Compliance)
Must implement missing control flow:
1. Firewall log streaming (replace sleep)
2. Container cleanup and health checks
3. maxIterations enforcement in mainLoop
4. --once, --step, signal handling
5. Final verification when all features pass

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
- [ ] **Rewrite main.ts as production entry point** (refs: src/main.ts:17-64, specs/orchestrator.md)
  - CONFIRMED: main.ts is STILL a placeholder stub (line 17: "NOTE: This is a placeholder implementation")
  - Current state: Uses hard-coded placeholders at lines 29-46, no createSession call, type cast workaround at line 63
  - Required sequence: args → validate config → validate features.json → createSession → mainLoop
  - Remove ALL placeholder values (placeholderContainerName, placeholderPrompt, placeholderState)
  - Call createSession() from program.ts to initialize container (function exists and works)
  - Extract containerName from createSession result for MainLive layer
  - Build MainLive layer with real runtime values (not placeholders)
  - Proper error handling with Effect.catchTag instead of catchAll + type cast
  - Load templates/ralph-instructions.md into memory (don't write to container - that's in runIteration)
  - Template loading is in-memory for main.ts; writing to container happens in program.ts during each iteration

- [ ] **Add features.json validation at startup** (refs: specs/features.md, src/args.ts:17, src/container.ts:41)
  - CONFIRMED: Code supports features.json but main.ts does NOT validate file existence
  - Default path: `.ralph/features.json` (override via --features-path CLI flag)
  - Test example at `/workspace/test-features.json` shows expected schema
  - Validation requirements:
    1. Check file exists at args.featuresPath using Effect.tryPromise with fs.access
    2. Read and parse JSON to validate structure (has "features" array)
    3. Validate each feature has required fields: id, description, passes (all required per specs/features.md:6-19)
    4. If missing/invalid, fail with FeatureError containing helpful message
  - Error messages:
    - File not found: "Features file not found at {path}. See test-features.json for example format."
    - Invalid JSON: "Features file contains invalid JSON: {error}"
    - Missing features array: "Features file must contain a 'features' array"
    - Invalid feature: "Feature missing required field: {field}"
  - CRITICAL: Add schema validation - currently JSON.parse has NO error handling (src/container.ts:42)

- [ ] **Integrate dashboard with main orchestration loop** (refs: specs/dashboard.md, src/layers/DashboardLive.ts)
  - DashboardLive exists and is in MainLive layer, but NOT connected to orchestration loop
  - Start dashboard server before main loop (if --dashboard flag, call dashboard.start())
  - Initialize dashboard state with: containerName, branch, maxIterations, stepMode from args
  - Update dashboard during mainLoop:
    - Call dashboard.setIteration() at start of each iteration
    - Call dashboard.setFeatures() after reading features.json from container
    - Call dashboard.setRunning(true) before Claude runs, setRunning(false) after
    - Call dashboard.setClaudeRunning(true/false) around Claude execution
  - Hook pause/resume controls: check dashboard.getState().paused before each iteration
  - Shutdown cleanly: call dashboard.stop() in finally block before exit
  - MISSING: Stream Claude events to dashboard (Priority 3 - requires using runWithEvents instead of run)

- [ ] **Remove legacy server.ts** (refs: src/server.ts, src/layers/DashboardLive.ts)
  - CONFIRMED: server.ts STILL EXISTS and is UNUSED legacy code (zero imports found via codebase search)
  - DashboardLive.ts is the ACTIVE Effect-based implementation integrated in MainLive layer (src/layers/index.ts:28-40)
  - Architectural differences:
    - server.ts: Imperative style, mutable global state, no cleanup mechanism
    - DashboardLive.ts: Effect-based, immutable Ref for state, Layer.scoped with finalizer
  - DECISION CONFIRMED: **Delete src/server.ts entirely** - it's duplicate pre-Effect code
  - Keep DashboardLive.ts and DashboardTest.ts (active implementation + test mock)

## Priority 2: High - ZFC Compliance & Orchestrator Specs

### Session Management
- [ ] **Implement proper firewall readiness detection** (refs: src/program.ts:72, specs/container.md)
  - CONFIRMED: program.ts:72 has TODO comment for this exact feature
  - Current: Uses `Effect.sleep("3 seconds")` as placeholder (program.ts:72-73)
  - Required: Replace with log streaming to detect "Ralph Firewall Ready" message
  - Implementation:
    1. Use docker.execStream (method exists in DockerService) to stream container logs
    2. Use `docker logs -f <container>` to follow logs in real-time
    3. Parse each log line looking for exact string "Ralph Firewall Ready"
    4. Exit stream and continue when message detected
    5. Timeout after 10 seconds if message never appears (use Effect.timeout)
    6. Fail with DockerError if timeout reached
  - Note: Firewall setup happens during container initialization in ralph-base image

- [ ] **Add cleanup for stale containers** (refs: specs/orchestrator.md)
  - NEW FINDING: Function does not exist anywhere in codebase
  - Required per spec: Clean up old ralph-* containers before starting new session
  - Implementation:
    1. Create `cleanupStaleContainers()` function in src/program.ts
    2. Use DockerService.list() to find all containers (or add listByPrefix method)
    3. Filter containers where name starts with "ralph-"
    4. For each old container, call docker.remove()
    5. Call from main.ts before createSession()
  - Alternative: Add to createSession as first step (may be cleaner)
  - Prevents accumulation of stopped containers from previous runs

- [ ] **Add container health check** (refs: specs/orchestrator.md)
  - NEW FINDING: Function does not exist anywhere in codebase
  - Required per spec: Verify container is running before each iteration
  - Implementation:
    1. Create `ensureContainerRunning(containerName)` function in src/program.ts
    2. Call docker.inspect(containerName) to get container state
    3. Check if state.Status === "running" (Docker returns: running, exited, paused, etc.)
    4. If not running, attempt docker.start(containerName) to restart
    5. If start fails, return DockerError
    6. Call from mainLoop before each runIteration
  - Prevents cryptic errors when container stops unexpectedly mid-session
  - DockerService may need inspect() and start() methods added (check if they exist)

### Iteration Control
- [ ] **Implement max iterations limit** (refs: specs/orchestrator.md, src/program.ts:291-295)
  - CONFIRMED: mainLoop while condition at program.ts:293-295 does NOT check maxIterations
  - Current logic: `(state.iteration === 0 || state.remainingFeaturesCount > 0) && state.noChangeCount < 3`
  - Required: Add `&& state.iteration < maxIterations` to while condition
  - Pass maxIterations from args through MainLive layer to mainLoop
  - When limit reached, return final state with clear message (not an error - just stop)
  - Timeout is 10 minutes per iteration (program.ts:242), consider if this matches spec (spec says 5 minutes)

- [ ] **Implement --once flag behavior** (refs: src/args.ts:19, specs/orchestrator.md)
  - CONFIRMED: Flag parsed at args.ts:19 but NOT implemented in orchestration
  - Current: args.once exists and is passed to MainLive, but mainLoop ignores it
  - Required: When args.once is true, set maxIterations = 1 before calling mainLoop
  - Or modify mainLoop while condition to check `!once || iteration === 0`
  - Exit after single iteration regardless of remaining features or circuit breaker

- [ ] **Implement --step flag behavior** (refs: src/args.ts:25, specs/orchestrator.md, specs/dashboard.md)
  - CONFIRMED: Flag parsed at args.ts:25 but NOT implemented in orchestration
  - Current: args.step exists, passed to dashboard initial state as stepMode, but no pause logic
  - Required implementation:
    1. Initialize dashboard with stepMode: args.step
    2. After each iteration, check dashboard.getState().paused
    3. If paused (due to stepMode), wait in loop until dashboard.getState().paused becomes false
    4. Display console message: "Paused in step mode - waiting for resume via dashboard"
    5. Dashboard /resume endpoint sets paused = false (already implemented in DashboardLive.ts)
  - Effect pattern: Use Effect.repeat with Schedule.spaced("1 second") to poll dashboard state

- [ ] **Add signal handling for graceful shutdown** (refs: specs/orchestrator.md)
  - NEW FINDING: No SIGINT/SIGTERM handlers in main.ts
  - Required per spec:
    - First signal: Set stopping flag, abort running Claude process, exit cleanly
    - Second signal: Force exit immediately
  - Implementation:
    1. Use process.on('SIGINT', handler) and process.on('SIGTERM', handler)
    2. First signal: Call dashboard.setStopping(true), attempt graceful cleanup
    3. Second signal: Call process.exit(1)
  - Integrate with DashboardService.stopping field (already exists in state)

### Final Verification
- [ ] **Implement final verification run** (refs: specs/orchestrator.md)
  - NEW FINDING: NOT implemented at all - no logic for "all features complete"
  - Required flow per spec:
    1. When mainLoop detects remainingFeaturesCount === 0, check finalVerificationDone flag
    2. First time (finalVerificationDone === false):
       - Run Claude with special prompt: "All features complete. Run final verification: bun run typecheck && bun test && bun run build"
       - If verification fails, Claude fixes issues and commits
       - Set finalVerificationDone = true
       - Continue mainLoop
    3. Second time (finalVerificationDone === true && remainingFeaturesCount === 0):
       - All features still pass after verification
       - Mark PR as ready for review (remove draft status)
       - Exit with success
  - Implementation location: Add to mainLoop logic in program.ts around line 293-295
  - Need to track finalVerificationDone in iteration state
  - Need separate prompt template for final verification (not in templates/ralph-instructions.md)

## Priority 3: Medium - Missing Implementation Details

### Docker Operations
- [ ] **Implement DockerService.copyToContainer** (refs: src/services/Docker.ts:111, src/layers/DockerLive.ts:290)
  - CONFIRMED STILL MISSING: Returns `Effect.dieMessage("Not implemented yet")` at DockerLive.ts:290
  - NOTE: May not be critical - features.json can be copied via docker.writeFile (already used elsewhere)
  - Alternative implementations:
    1. Use `docker cp` command via Effect.tryPromise
    2. Use docker.writeFile with file contents read from host
    3. Use docker exec with cat/heredoc (already working pattern in codebase)
  - Check if anything actually calls copyToContainer - may be safe to leave unimplemented
  - If needed for features.json: createSession already handles file copying (per plan line 33 reference to ralph.ts:208-213)

### Git Operations
- [ ] **Add git user configuration** (refs: specs/orchestrator.md, src/services/Git.ts)
  - CONFIRMED: GitService.configureUser method exists in service interface
  - Current: NOT called during createSession (checked program.ts:23-198)
  - Required: Call git.configureUser() after cloning in createSession (program.ts, after line 135)
  - Configuration source:
    - Read from environment: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL (add to ConfigService)
    - Default to "Ralph Bot <ralph@anthropic.com>" if not set
  - Implementation: Add to ConfigService as optional fields, pass through SessionConfig

- [ ] **Handle merge conflicts gracefully** (refs: specs/orchestrator.md, src/program.ts:252-257)
  - Current: program.ts:252-257 pushes changes but no conflict handling
  - If git.push() fails (Effect.fail), no retry logic
  - Required per spec:
    1. Wrap git.push in Effect.catchTag to catch GitError
    2. On GitError, check if message contains "merge conflict" or "rejected"
    3. If conflict detected:
       - Run git.fetch() to get remote changes
       - Run git.pull() with --rebase flag (may need to add pullRebase method)
       - Retry git.push with --force-with-lease (safer than --force)
    4. If second push fails, propagate error (don't retry infinitely)
  - GitService may need additional methods: fetch(), pullRebase()

### Claude Integration
- [ ] **Stream Claude events to dashboard** (refs: specs/claude-integration.md, specs/dashboard.md, src/services/Claude.ts)
  - CONFIRMED: runWithEvents exists in ClaudeService (src/services/Claude.ts) but NOT used in program.ts
  - Current: program.ts:239-249 calls claude.run() which returns summary only
  - Required: Switch to claude.runWithEvents() and process NDJSON stream
  - Implementation:
    1. Change program.ts to call runWithEvents instead of run
    2. Stream events from Claude through Effect.Stream
    3. For each event, call dashboard.broadcast({ type: "claude_event", data: event })
    4. NDJSON parsing already implemented in ClaudeLive.ts (uses parseNDJSON from streams.ts)
  - Enables real-time Claude activity display in dashboard UI
  - Lower priority than basic orchestration working

- [ ] **Add Claude process abort on /stop** (refs: specs/dashboard.md, src/layers/DashboardLive.ts)
  - NEW FINDING: DashboardService has setStopping() method but no killClaude capability
  - Required per spec:
    - POST /stop should immediately abort running Claude process
    - Need to pass AbortSignal through to claude.run/runWithEvents
    - Dashboard state needs reference to current AbortController
    - Call abort() when /stop endpoint hit
  - Implementation approach:
    1. Create AbortController before calling claude.run in program.ts
    2. Pass controller.signal to claude.run as abort parameter
    3. Store controller reference in dashboard state (or main.ts state)
    4. POST /stop calls controller.abort()
  - Requires architectural change: main.ts needs to coordinate between dashboard and claude services

### Configuration
- [ ] **Add helpful error for missing CLAUDE_CODE_OAUTH_TOKEN** (refs: src/layers/ConfigLive.ts, src/services/Config.ts)
  - CONFIRMED: ConfigService validates token exists but error message is generic
  - Current: Effect.fail with ConfigError when token missing
  - Required: Better error message with recovery instructions
  - Suggested message: "CLAUDE_CODE_OAUTH_TOKEN not found. To fix: export CLAUDE_CODE_OAUTH_TOKEN=$(claude auth print-token)"
  - Add link to docs: https://github.com/anthropics/claude-code
  - Implementation: Update ConfigLive.ts token validation logic to include helpful error

- [ ] **Auto-generate branch name if not provided** (refs: specs/orchestrator.md, src/args.ts:21)
  - CONFIRMED: Branch is required per args.ts:21, but spec says should auto-generate if missing
  - Current: args.branch is required string in Args type
  - Required format: `ralph/MMDD-HHMM-{feature-slug}`
  - Implementation:
    1. Make args.branch optional in Args type (string | undefined)
    2. If undefined, read features.json to extract first feature ID
    3. Slugify feature ID: lowercase, replace spaces with hyphens, truncate to 20 chars
    4. Generate timestamp: new Date() formatted as MMDD-HHMM in local timezone
    5. Construct branch name: `ralph/${timestamp}-${slug}`
    6. Example: `ralph/0123-1430-setup-project`
  - Location: Add utility function in src/container.ts, call from main.ts before createSession

### Error Handling & Edge Cases
- [ ] **Add features.json error handling** (refs: src/container.ts:41-44, src/program.ts:221-232)
  - CRITICAL FINDING: No error handling for invalid features.json structure
  - Current issues:
    - JSON.parse() at container.ts:42 has NO try-catch (uncaught SyntaxError if invalid JSON)
    - No validation that parsed object has "features" property (crashes on undefined.features)
    - No validation that features array elements have required fields (passes, id, description)
    - Missing field treated as falsy (f.passes === undefined → treated as incomplete feature)
  - Required error handling:
    1. Wrap JSON.parse in Effect.try with mapError to FeatureError
    2. Validate parsed.features exists and is array (Effect.filterOrFail)
    3. Validate each feature has required fields (passes: boolean, id: string, description: string)
    4. Return helpful error: "Invalid features.json: {specific problem}"
  - Add test coverage for error cases (currently only happy path tested in container.test.ts:65-108)

- [ ] **Add timeout handling for Claude runs** (refs: src/program.ts:242)
  - Current: 10-minute timeout set at program.ts:242
  - Spec says 5 minutes (discrepancy - which is correct?)
  - No specific handling when timeout occurs - just Effect.fail
  - Consider: Should timeout be configurable via CLI flag?
  - Consider: Should timeout extend message include hint about --max-iterations for complex features?

- [ ] **Improve error messages for Docker failures** (refs: src/services/Docker.ts, src/layers/DockerLive.ts)
  - DockerError provides command and cause, but messages may be cryptic
  - Common failure modes:
    - Container already exists (name conflict) - suggest cleanup or different name
    - Docker daemon not running - suggest `docker ps` to verify
    - Network issues - suggest checking firewall rules
    - Permission denied - suggest checking Docker socket permissions
  - Add error hints to DockerError based on error patterns in cause message

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

### Main Entry Point Status (CRITICAL FINDING - RECONFIRMED)
- **src/main.ts is STILL a placeholder stub** (verified line 17: "NOTE: This is a placeholder implementation")
- **NO CHANGES since last plan iteration** - all previous findings remain accurate
- All infrastructure is COMPLETE and working:
  - ✅ createSession() in program.ts - Creates and initializes container (program.ts:23-198)
  - ✅ runIteration() in program.ts - Runs single orchestration loop (program.ts:212-264)
  - ✅ mainLoop() in program.ts - Implements Effect.iterate with circuit breaker (program.ts:281-333)
  - ✅ parseArgs() in args.ts - CLI argument parsing with all flags (args.ts:16-48)
  - ✅ All services (Docker, Claude, Git, Config, Dashboard) fully implemented
  - ✅ All layers with proper Effect composition
  - ✅ 80 tests passing, zero TypeScript errors
- Main.ts needs complete rewrite to connect all the working pieces
- Placeholder values still present at lines 29-46:
  - Hard-coded containerName: "ralph-session-placeholder" (line 30)
  - Hard-coded prompt string (line 31)
  - Dummy dashboard state object (lines 34-46)
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

### Features Configuration (CODE READY, VALIDATION MISSING)
- `.ralph/features.json` is currently MISSING from workspace (expected - user provides it)
- Code is READY for features.json (found 19 file references):
  - program.ts:221-232 - Reads from container via docker.readFile
  - container.ts:41-44 - Parses JSON and filters remaining features (getRemainingFeatures)
  - args.ts:17 - Default path `.ralph/features.json`, CLI override via --features-path
  - specs/features.md:6-19 - Complete schema specification
  - templates/ralph-instructions.md - Claude instructions to read/process features.json
- Test example exists at `/workspace/test-features.json` showing exact format
- Schema: `{ features: [{ id, description, passes, verify_command }] }`
- **CRITICAL GAP**: NO error handling or validation
  - JSON.parse at container.ts:42 has no try-catch (uncaught SyntaxError if invalid)
  - No validation that parsed.features exists (crashes on undefined)
  - No validation of required fields (id, description, passes)
  - Missing fields treated as falsy instead of error
- **REQUIRED**: Add validation at startup (Priority 1) and parse-time (Priority 3)
- Not a blocker for user - they will provide features.json when running Ralph

### Test Coverage Status
- 80 tests passing (args, container, errors, streams, program)
- Zero TypeScript errors
- No tests yet for main.ts entry point (because it's still a placeholder)
- Missing integration tests for full orchestration flow
- Error case coverage missing for features.json parsing (only happy path tested)
- No tests for timeout handling, signal handling, or dashboard integration

### Missing Orchestrator Functions (NEW FINDINGS)
- **cleanupStaleContainers()** - Does not exist, spec requires it before session creation
- **ensureContainerRunning()** - Does not exist, spec requires it before each iteration
- **Final verification logic** - Not implemented in mainLoop
- **Step mode pause logic** - Not implemented despite --step flag being parsed
- **Signal handlers** - No SIGINT/SIGTERM handlers for graceful shutdown
- **Branch name generation** - No auto-generation when --branch not provided

### TODO Comments in Codebase (COMPREHENSIVE SEARCH)
- **program.ts:72** - "TODO: Implement proper log streaming to detect Ralph Firewall Ready message"
- **DockerLive.ts:290** - `copyToContainer: () => Effect.dieMessage("Not implemented yet")`
- **main.ts:17** - "NOTE: This is a placeholder implementation"
- All other "not implemented" markers are in test mocks (program.test.ts) - intentional fixtures

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
- **main.ts production implementation** - STILL placeholder stub at line 17
- **Dashboard integration** - DashboardLive exists but not started/updated in main loop
- **Features.json validation** - No file existence check or schema validation at startup
- **Features.json error handling** - JSON.parse has no try-catch, crashes on invalid structure
- **Template loading** - templates/ralph-instructions.md not read in main.ts (happens in runIteration)
- **Firewall readiness detection** - Uses Effect.sleep("3 seconds") instead of log streaming (program.ts:72-73)
- **Container cleanup** - cleanupStaleContainers() function does not exist
- **Container health checks** - ensureContainerRunning() function does not exist
- **Iteration limits** - maxIterations parsed but not checked in mainLoop while condition
- **--once flag** - Parsed but ignored by mainLoop (should set maxIterations=1)
- **--step flag** - Parsed but no pause/resume logic (should wait for dashboard resume)
- **Signal handling** - No SIGINT/SIGTERM handlers for graceful shutdown
- **Final verification** - No logic for when all features.passes === true
- **Git user config** - configureUser method exists but not called in createSession
- **Merge conflict handling** - git.push has no retry logic with rebase
- **Branch auto-generation** - No auto-generation when --branch missing (spec requires it)
- **server.ts removal** - Legacy unused code still present (zero imports)

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
