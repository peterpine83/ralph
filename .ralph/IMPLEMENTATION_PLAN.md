# Implementation Plan

## Overview
Ralph has a well-architected Effect-based foundation with comprehensive service layers, but requires completion of the main entry point and implementation of the Logging & Telemetry system specified in specs/logging-telemetry.md.

## Completed
- [x] Effect-based service architecture (ConfigService, DockerService, ClaudeService, GitService, DashboardService)
- [x] Live layer implementations with proper dependency injection
- [x] Test layer implementations for all services
- [x] Orchestration program logic (createSession, runIteration, mainLoop) in src/program.ts
- [x] Stream utilities for NDJSON parsing (src/streams/ndjson.ts)
- [x] Comprehensive error handling with tagged error types
- [x] Dashboard SSE server with state management
- [x] Docker container lifecycle management
- [x] Git operations via Docker exec
- [x] CLI argument parsing with mode support (plan/build)
- [x] Extensive test coverage (program.test.ts, errors, streams, args, container)

## Priority 1: Critical Path - Main Entry Point

### Task 1.1: Implement real main.ts entry point
**Status**: BLOCKING - Currently a 69-line placeholder
**Files**: `src/main.ts`
**Refs**: specs/orchestrator.md, src/program.ts (working implementation)

The placeholder needs replacement with proper integration:
1. Remove placeholder implementation (lines 17-68)
2. Call `createSession()` with proper SessionConfig from CLI args
3. Read features.json from container (build mode only)
4. Load appropriate prompt template based on mode
5. Initialize dashboard if `--dashboard` flag is set
6. Call `mainLoop()` with proper state initialization
7. Handle all CLI arguments (--step, --once, --max-iterations, --branch, --mode)
8. Fix error handling to use proper `catchTags` instead of workaround `catchAll`
9. Ensure cleanup happens in finally block

**Dependencies**: None - all supporting code exists in program.ts
**Verification**: `bun run typecheck && bun test`

## Priority 2: Logging & Telemetry System

### Task 2.1: Create LoggingService interface and types
**Files**: `src/services/Logging.ts` (new)
**Refs**: specs/logging-telemetry.md

Define service interface with methods:
- `initSession(sessionId: string)` - Create new session log file
- `appendEvent(event: ClaudeEvent | IterationEvent)` - Append JSONL line
- `readSession(sessionId: string)` - Read full session log
- `readIteration(sessionId: string, iteration: number)` - Read specific iteration
- `listSessions()` - List available session IDs

Define types:
- `SessionLog` - Session metadata + events array
- `IterationBoundary` - `{type: "iteration_start", iteration: number, timestamp: string}`

**Dependencies**: None
**Verification**: Type checking passes

### Task 2.2: Implement LoggingLive layer
**Files**: `src/layers/LoggingLive.ts` (new)
**Refs**: specs/logging-telemetry.md

Implementation details:
- Store logs at `.ralph/sessions/{session-id}.jsonl`
- Use Node.js fs APIs via @effect/platform FileSystem
- Write JSONL format (one JSON object per line)
- Insert `iteration_start` markers before each iteration
- Handle file creation, appending, reading with proper error handling

**Dependencies**: Task 2.1
**Verification**: Unit tests for JSONL write/read roundtrip

### Task 2.3: Integrate logging into program.ts
**Files**: `src/program.ts`
**Refs**: specs/logging-telemetry.md

Integration points:
- At start of `mainLoop()`: Call `LoggingService.initSession()`
- At start of each iteration in `runIteration()`: Append `iteration_start` event
- In Claude streaming: Pipe all ClaudeEvent objects to `LoggingService.appendEvent()`
- Ensure logging doesn't block execution (fire-and-forget with proper error logging)

**Dependencies**: Task 2.2
**Verification**: Run orchestrator and verify JSONL file created with events

### Task 2.4: Add logging HTTP endpoints to Dashboard
**Files**: `src/services/Dashboard.ts`, `src/layers/DashboardLive.ts`
**Refs**: specs/logging-telemetry.md

New endpoints:
- `GET /api/sessions` - List all session IDs
- `GET /api/sessions/:sessionId` - Get full session log
- `GET /api/sessions/:sessionId/iterations/:iteration` - Get specific iteration events

Response format: `{success: true, data: {...}}` or `{success: false, error: string}`

**Dependencies**: Task 2.2
**Verification**: Manual testing with curl/browser

### Task 2.5: Implement dashboard UI iteration sidebar
**Files**: `dashboard/index.html`, `dashboard/styles.css`, `dashboard/script.js`
**Refs**: specs/logging-telemetry.md (Phase 2)

UI Components:
- Left sidebar showing iteration list
- Each iteration shows: number, timestamp, status (running/completed/error), token count, context %
- Click iteration to filter activity log to that iteration
- Highlight current iteration
- Auto-scroll to current iteration

**Dependencies**: Task 2.4
**Verification**: Manual testing in browser with running orchestrator

### Task 2.6: Enhance activity log with syntax highlighting
**Files**: `dashboard/script.js`, `dashboard/styles.css`
**Refs**: specs/logging-telemetry.md (Phase 3)

Enhancements:
- Tool calls expanded by default with collapse button
- Detect file type from file_path in tool calls
- Apply syntax highlighting (use lightweight library or CSS-based approach)
- Collapsible sections for long outputs
- Monospace font for code blocks
- Preserve ANSI color codes if present

**Dependencies**: Task 2.5
**Verification**: Manual testing with various tool outputs

### Task 2.7: Add subagent tracking for Task tool
**Files**: `dashboard/script.js`
**Refs**: specs/logging-telemetry.md (Phase 4)

Features:
- Detect Task tool invocations from ClaudeEvent stream
- Display spinner with subagent type and prompt during execution
- Show timing information when subagent completes
- Nest subagent output under parent task

**Dependencies**: Task 2.6
**Verification**: Run orchestrator with features that use Task tool

### Task 2.8: Implement prompt editing and re-run capability
**Files**: `dashboard/index.html`, `dashboard/script.js`, `src/services/Dashboard.ts`
**Refs**: specs/logging-telemetry.md (Phase 5)

Features:
- "Edit & Re-run" button on each iteration
- Modal/popup with editable prompt text
- `POST /api/sessions/:sessionId/iterations/:iteration/rerun` endpoint
- Backend: Update prompt file, restart from that iteration
- Frontend: Show re-run status and new iteration results

**Dependencies**: Task 2.7
**Verification**: Edit prompt and verify orchestrator re-runs from that point

## Priority 3: Polish & Refinement

### Task 3.1: Implement firewall ready detection
**Files**: `src/program.ts:74`
**Refs**: TODO comment

Replace `Effect.sleep("3 seconds")` with proper log streaming:
- Use `DockerService.execStream()` to tail container logs
- Parse output for "Ralph Firewall Ready" message
- Timeout after 30 seconds if message not detected
- More reliable than arbitrary sleep duration

**Dependencies**: None
**Verification**: Verify container starts correctly and proceeds when ready

### Task 3.2: Implement DockerLive.copyToContainer
**Files**: `src/layers/DockerLive.ts:290`
**Refs**: Current implementation uses Effect.dieMessage

Implementation:
- Use `docker cp <local-path> <container>:<remote-path>` command
- Handle errors and convert to DockerError
- Add proper types and documentation

**Dependencies**: None
**Verification**: Unit test with mock docker cp command

### Task 3.3: Fix Effect type workarounds (as any)
**Files**: `src/layers/GitLive.ts:138`, `src/layers/ClaudeLive.ts:129`, `src/layers/DashboardLive.ts:188`
**Refs**: Comments note "Use 'as any' workaround" for effect-020 issue

Options:
1. Wait for Effect update that fixes Context.Tag shadowing issue
2. Refactor to avoid interface/class name conflicts
3. Use explicit type annotations instead of inference

**Dependencies**: None (non-blocking)
**Verification**: Type checking passes without warnings

## Priority 4: Documentation & Testing

### Task 4.1: Add integration tests for logging system
**Files**: `src/services/Logging.test.ts` (new)

Test coverage:
- Session creation and JSONL file persistence
- Event appending with proper formatting
- Iteration boundary markers
- Reading full session and specific iterations
- Error handling for missing files

**Dependencies**: Task 2.2
**Verification**: `bun test`

### Task 4.2: Add end-to-end test for main orchestrator flow
**Files**: `src/main.test.ts` (new)

Test scenarios:
- Full orchestrator run with mock features
- Circuit breaker trigger after 3 no-change iterations
- Dashboard integration (if enabled)
- Step mode with pause/resume
- Plan mode vs build mode differences

**Dependencies**: Task 1.1
**Verification**: `bun test`

### Task 4.3: Update CLAUDE.md with logging system usage
**Files**: `CLAUDE.md`

Document:
- Where session logs are stored
- How to access logs via dashboard
- JSONL format specification
- How to use logs for prompt tuning

**Dependencies**: Task 2.3
**Verification**: Manual review

## Discoveries

- **Effect migration is COMPLETE**: All five phases from recent commits are done (see git log)
- **Existing standard library** is comprehensive: Don't rewrite DockerService, GitService, etc.
- **Test layers exist**: Use ConfigTest, DockerTest, etc. for unit testing
- **Stream utilities ready**: parseNDJSON() handles Claude's stream-json output format
- **ZFC architecture**: Ralph delegates ALL reasoning to Claude, no heuristics or keyword matching
- **Two operational modes**: Plan mode generates .ralph/IMPLEMENTATION_PLAN.md, build mode implements features.json

## Blockers

None - all dependencies for Priority 1 are already implemented in program.ts. The main.ts placeholder is the only thing preventing the orchestrator from running.

## Implementation Order Rationale

**Priority 1 first**: The main entry point is the critical path. Without it, Ralph cannot run at all. All the orchestration logic exists in program.ts but is never called.

**Priority 2 second**: Logging & telemetry is a complete new feature specified in specs/logging-telemetry.md. It's independent of the main entry point and can be implemented in parallel or after.

**Priority 3 third**: Polish items that improve reliability but don't block core functionality.

**Priority 4 last**: Documentation and additional test coverage to ensure maintainability.

## Verification Strategy

After each priority:
- Run `bun run typecheck` - All TypeScript types must resolve
- Run `bun test` - All tests must pass
- For Priority 1: Manually run Ralph with `--once` flag to verify single iteration works
- For Priority 2: Verify .ralph/sessions/{id}.jsonl exists and contains valid JSONL
- For Priority 3: Verify container starts reliably and docker cp works if needed

## Next Steps

Begin with **Task 1.1**: Replace src/main.ts placeholder with real implementation that calls program.ts functions. This unblocks the entire orchestrator.
