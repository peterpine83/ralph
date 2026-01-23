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
- [ ] **Fix main.ts to call createSession** (refs: src/main.ts, specs/orchestrator.md)
  - Remove placeholder values (containerName, prompt, state)
  - Read `.ralph-prompt.md` template from git root
  - Call createSession() to initialize container
  - Build MainLive layer with actual runtime values
  - Sequence: args → config → createSession → mainLoop
  - Proper error handling without `as Effect.Effect<void, never, never>` workaround

- [ ] **Implement features.json initialization** (refs: specs/features.md)
  - Check if `.ralph/features.json` exists in git root
  - If missing, fail with helpful error message
  - Pass features path through SessionConfig
  - Copy features.json to container during createSession

- [ ] **Integrate dashboard with main orchestration loop** (refs: specs/dashboard.md, src/layers/DashboardLive.ts)
  - Start dashboard server before main loop (if --dashboard flag)
  - Update dashboard state at each iteration:
    - Broadcast iteration progress
    - Broadcast feature status changes
    - Stream Claude events to dashboard
  - Hook pause/resume/step controls to main loop
  - Shutdown dashboard cleanly on exit

- [ ] **Remove or consolidate server.ts** (refs: src/server.ts, src/layers/DashboardLive.ts)
  - Decision needed: DashboardLive (Effect-based) vs server.ts (imperative)
  - DashboardLive is correct pattern - remove server.ts OR
  - Clarify if server.ts is for standalone testing

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

### Existing Standard Library (src/)
- Found comprehensive Effect.ts-based architecture
- All services use Context.Tag pattern with Layer factories
- Stream utilities handle NDJSON parsing with fallback
- Error system has 10 typed errors with catchTag support
- Container utilities parse docker/git output correctly
- **Extend these patterns** - do not rewrite

### Duplicate Dashboard Implementation
- DashboardLive.ts (Effect-based, immutable state via Ref) - ✅ CORRECT
- server.ts (imperative, mutable global state) - ⚠️ DUPLICATE
- Need to clarify: Remove server.ts or use for standalone testing?

### Template System
- Prompt template lives in `/workspace/templates/ralph-instructions.md`
- Should be read during main.ts initialization
- Contains critical rules for Claude iterations
- Must be loaded and passed to runIteration

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

## Implementation Order Recommendation

1. **Start with Priority 1** - Make the entry point work
   - Fix main.ts to use real createSession
   - Load .ralph-prompt.md template
   - Integrate dashboard startup
   - Remove/consolidate server.ts

2. **Then Priority 2** - Complete orchestrator compliance
   - Firewall readiness detection
   - Container cleanup and health checks
   - Iteration limits (maxIterations, --once, --step)
   - Final verification run

3. **Then Priority 3** - Fill implementation gaps
   - Stream Claude events to dashboard
   - Handle git conflicts
   - Better error messages
   - Auto-generate branch names

4. **Finally Priority 4** - Polish
   - Remove workarounds
   - Add tests
   - Documentation

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
