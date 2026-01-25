# Implementation Plan

## Executive Summary

Ralph has two parallel implementations:
1. **Shell-based (`ralph.ts`)**: Fully functional, production-ready (642 lines)
2. **Effect-based (`src/`)**: Clean service architecture, but incomplete orchestration

The Effect-based architecture is well-designed with service abstractions, typed errors, and test layers. However, the main entry point (`src/main.ts`) is a placeholder, and several critical orchestration features are missing.

---

## Completed

- [x] Service interfaces defined (Config, Docker, Claude, Git, Dashboard)
- [x] Layer implementations working (ConfigLive, DockerLive, ClaudeLive, GitLive, DashboardLive)
- [x] Test layers for all services (src/layers/test/)
- [x] Error types with Data.TaggedError pattern
- [x] Stream utilities for NDJSON parsing (src/streams/ndjson.ts)
- [x] Container utility functions (generateContainerName, parseStaleContainers, etc.)
- [x] CLI argument parsing (src/args.ts)
- [x] Main loop with circuit breaker logic (src/program.ts:mainLoop)
- [x] createSession function (src/program.ts:23-200)
- [x] runIteration function (src/program.ts:214-266)
- [x] Dashboard SSE server (src/layers/DashboardLive.ts)
- [x] Dashboard UI scaffolding (dashboard/)

---

## Priority 1: Complete Effect-Based Main Entry Point

The current `src/main.ts` is explicitly marked as a placeholder (lines 17-24). It uses hardcoded placeholder values instead of actually creating a container session.

### Tasks

- [ ] **P1.1** Implement full session lifecycle in `src/main.ts`
  - Call `createSession()` to create and initialize container
  - Extract `containerName` from session result
  - Build `MainLive` layer with actual runtime values
  - Run `mainLoop` with correct parameters
  - **Refs**: `specs/orchestrator.md`, `src/main.ts:17-24`

- [ ] **P1.2** Implement `cleanupStaleContainers()` in `src/program.ts`
  - Use `DockerService.listByPrefix("ralph-")` to find existing containers
  - Remove each container with `DockerService.remove()`
  - Call at startup before creating new session
  - **Refs**: `specs/orchestrator.md:56-59`, `src/services/Docker.ts:121-122`

- [ ] **P1.3** Implement `ensureContainerRunning()` in `src/program.ts`
  - Use `DockerService.inspect()` to check container state
  - Call `DockerService.start()` if not running
  - Called at the start of each iteration
  - **Refs**: `specs/orchestrator.md:61-64`, `src/services/Docker.ts:59-60`

- [ ] **P1.4** Implement `cleanupSession()` in `src/main.ts`
  - Remove container on exit (success or failure)
  - Use `Effect.ensuring()` or `Effect.acquireRelease()` pattern
  - **Refs**: `specs/orchestrator.md:48-51`

- [ ] **P1.5** Replace firewall wait hack with proper log streaming
  - Current: `Effect.sleep("3 seconds")` at `src/program.ts:75`
  - Needed: Stream container logs and detect "Ralph Firewall Ready" message
  - Use `DockerService.execStream()` with docker logs
  - **Refs**: `specs/container.md:73-74`, `src/program.ts:74-75` (TODO comment)

---

## Priority 2: Missing Orchestration Features

### Tasks

- [ ] **P2.1** Implement signal handling (SIGINT/SIGTERM)
  - First signal: Set `stopping = true`, abort Claude process
  - Second signal: Force exit immediately
  - Update dashboard state to reflect shutdown status
  - **Refs**: `specs/orchestrator.md:154-166`

- [ ] **P2.2** Implement final verification flow
  - Track `finalVerificationDone` in iteration state
  - When all features pass: run Claude for final verification
  - If Claude pushes changes: reset flag
  - Second time all features pass without changes: exit successfully
  - **Refs**: `specs/orchestrator.md:125-137`

- [ ] **P2.3** Implement step mode checkpoint
  - After Claude completes and commits are pushed
  - If step mode enabled: set `paused = true`
  - Show CLI prompt: `[c]ontinue, [s]top`
  - Wait for user input OR dashboard resume
  - **Refs**: `specs/orchestrator.md:139-152`

- [ ] **P2.4** Write `.ralph-prompt.md` to container each iteration
  - Write prompt template to container filesystem
  - Claude reads this file instead of receiving prompt as CLI arg
  - Enables prompt editing via dashboard
  - **Refs**: `specs/claude-integration.md:26-31`

---

## Priority 3: Docker Service Completion

### Tasks

- [ ] **P3.1** Implement `DockerService.copyToContainer()`
  - Current: `Effect.dieMessage("Not implemented yet")` at `src/layers/DockerLive.ts:290`
  - Implement using `docker cp` command
  - **Refs**: `src/services/Docker.ts:116`

---

## Priority 4: Logging & Telemetry (Entire Spec Unimplemented)

The `specs/logging-telemetry.md` spec is entirely unimplemented. This is a large feature set with 5 phases.

### Phase 1: Persistence & Recovery

- [ ] **P4.1** Create `LoggingService` interface
  - `appendEvent(event)`: Append to session JSONL file
  - `getIterationEvents(iteration)`: Read events for specific iteration
  - `getSessionPath()`: Return path to current session log
  - **Refs**: `specs/logging-telemetry.md:49-53`

- [ ] **P4.2** Create `LoggingLive` layer
  - Write to `.ralph/sessions/{session-id}.jsonl`
  - Implement JSONL file appending
  - **Refs**: `specs/logging-telemetry.md:59-77`

- [ ] **P4.3** Emit `iteration_start` events
  - Write iteration boundary markers to JSONL
  - **Refs**: `specs/logging-telemetry.md:72-77`

- [ ] **P4.4** Add `/logs/:iteration` endpoint to `src/server.ts`
  - Return JSONL events for specific iteration
  - **Refs**: `specs/logging-telemetry.md:280-283`

- [ ] **P4.5** Add `/iterations` endpoint to `src/server.ts`
  - Return list of iterations with metrics
  - **Refs**: `specs/logging-telemetry.md:273-279`

- [ ] **P4.6** Implement browser recovery from JSONL on reconnect
  - Load state from JSONL when browser reconnects
  - **Refs**: `specs/logging-telemetry.md:260-269`

### Phase 2-5: Dashboard Enhancements

- [ ] **P4.7** Iteration sidebar component with metrics
  - Token count and context % calculation
  - Click to load iteration logs
  - Visual status indicators
  - **Refs**: `specs/logging-telemetry.md:79-110`

- [ ] **P4.8** Activity log improvements
  - Tool calls expanded by default
  - Syntax highlighting (Prism.js)
  - Collapsible summaries
  - Prompt display at iteration start
  - **Refs**: `specs/logging-telemetry.md:112-164`

- [ ] **P4.9** Subagent tracking
  - Task tool timing tracker
  - Spinner with elapsed time during Task execution
  - Prompt and result display
  - **Refs**: `specs/logging-telemetry.md:183-227`

- [ ] **P4.10** Prompt editing & re-run
  - Editable prompt textarea
  - `/rerun` endpoint
  - Re-run as new iteration
  - **Refs**: `specs/logging-telemetry.md:232-258`

---

## Priority 5: Plan Mode Completion

Plan mode is partially implemented but may need verification.

### Tasks

- [ ] **P5.1** Verify plan mode prompt template exists
  - Check `templates/ralph-plan-mode.md` matches requirements
  - **Refs**: `src/main.ts:33-35`

- [ ] **P5.2** Verify plan mode completion detection
  - Check `.ralph/plan-status.json` for `complete: true`
  - Exit loop when complete
  - **Refs**: `.ralph-prompt.md:14-41`

---

## Discoveries

### Existing Patterns to Follow

1. **Service Pattern**: All services use `Context.Tag` with interface prefixed by `I`
   - Location: `src/services/*.ts`

2. **Error Pattern**: All errors extend `Data.TaggedError` with unique `_tag`
   - Location: `src/errors/index.ts`

3. **Testing Pattern**: Test layers in `src/layers/test/` with combined `TestLive`
   - Location: `src/layers/test/index.ts`

4. **Stream Processing**: Use `parseNDJSON` from `src/streams/ndjson.ts`
   - Do not rewrite, extend if needed

### Working Implementation Reference

The shell-based `ralph.ts` is fully functional and can be used as reference:
- Signal handling: lines 84-102
- Step mode: lines 573-606
- Final verification: lines 484-494
- Container lifecycle: lines 136-236
- `.ralph-prompt.md` writing: lines 506-509

---

## Blockers

None identified. All features can be implemented with existing infrastructure.

---

## File Locations Summary

| Purpose | File |
|---------|------|
| Main entry (placeholder) | `src/main.ts` |
| Orchestration logic | `src/program.ts` |
| Docker service | `src/services/Docker.ts`, `src/layers/DockerLive.ts` |
| Claude service | `src/services/Claude.ts`, `src/layers/ClaudeLive.ts` |
| Dashboard service | `src/services/Dashboard.ts`, `src/layers/DashboardLive.ts` |
| Error types | `src/errors/index.ts` |
| Type definitions | `src/types.ts` |
| HTTP server | `src/server.ts` |
| Working reference | `ralph.ts` |
