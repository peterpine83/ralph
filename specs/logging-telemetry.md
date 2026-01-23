# Logging & Telemetry Specification

**Purpose**: Comprehensive logging and telemetry system for prompt tuning and performance optimization of Ralph sessions.

**Problem Statement**: The current dashboard loses all state on browser refresh, tool call content is difficult to read, there's no visibility into subagent activity, and iteration-level metadata (tokens, context usage) isn't tracked or displayed.

## Goals

1. **Persistent logging**: Session logs survive browser refresh and are queryable during the session
2. **Readable activity log**: Tool calls expanded by default with syntax highlighting and structured formatting
3. **Subagent visibility**: Track Task tool invocations with timing and prompts (within Claude's limitations)
4. **Iteration metrics**: Display token count and context window percentage per iteration
5. **Prompt editing**: Edit and re-run iterations for debugging and prompt tuning

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser                                         │
│  ┌───────────────────────┬──────────────────────────────────────────────┐   │
│  │    Iteration Sidebar   │              Activity Panel                   │   │
│  │  ┌──────────────────┐  │  ┌────────────────────────────────────────┐  │   │
│  │  │ Iteration 1      │  │  │  [Prompt]                              │  │   │
│  │  │ ✓ 12.5k tokens   │  │  │  Claude: Analyzing features.json...   │  │   │
│  │  │ 6.2% context     │  │  │                                        │  │   │
│  │  ├──────────────────┤  │  │  ┌─ Read src/main.ts:1-50 ──────────┐  │  │   │
│  │  │ Iteration 2      │  │  │  │ import { Effect } from "effect"  │  │  │   │
│  │  │ ● 8.2k tokens    │◀─┼──│  │ import { Config }...             │  │  │   │
│  │  │ 4.1% context     │  │  │  └──────────────────────────────────┘  │  │   │
│  │  ├──────────────────┤  │  │                                        │  │   │
│  │  │ Iteration 3      │  │  │  ⏳ Task: "Explore codebase" (42s)     │  │   │
│  │  │ ... (current)    │  │  │                                        │  │   │
│  │  └──────────────────┘  │  │  Claude: Found 12 TypeScript files...  │  │   │
│  └───────────────────────┴──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ SSE + REST
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             src/server.ts                                    │
│  ├─ GET  /events           → SSE stream (state + claude events)             │
│  ├─ GET  /logs/:iteration  → JSONL events for specific iteration           │
│  ├─ POST /rerun            → Re-run iteration with modified prompt          │
│  └─ ...existing endpoints                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LoggingService (NEW)                                 │
│  ├─ appendEvent(event)    → Append to session JSONL file                   │
│  ├─ getIterationEvents()  → Read events for specific iteration             │
│  └─ getSessionPath()      → Return path to current session log             │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                          .ralph/sessions/{session-id}.jsonl
```

## JSONL Log Format

Logs are stored as newline-delimited JSON in `.ralph/sessions/{session-id}.jsonl`. Events are **raw Claude events** passed through without modification.

**File naming**: `{session-id}.jsonl` where session-id matches the container name (e.g., `ralph-session-20250115-143052.jsonl`)

**Event format**: Raw Claude event JSON, one per line:
```jsonl
{"type":"system","subtype":"init","session_id":"abc","tools":["Read","Write"]}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"result","cost_usd":0.05,"duration_ms":45000}
```

**Iteration boundaries**: When a new iteration starts, a special `iteration_start` event is written:
```jsonl
{"type":"iteration_start","iteration":3,"timestamp":"2025-01-15T14:30:52Z"}
```

This allows the dashboard to load events for a specific iteration by scanning for boundaries.

## Iteration Sidebar

### Card Display

Each iteration card shows:
- **Title**: "Iteration N" (or feature name if available)
- **Status indicator**: ✓ (pass), ✗ (fail), ● (current/running)
- **Token count**: e.g., "12.5k tokens"
- **Context window %**: e.g., "6.2% of 200k"

### Card Calculation

Token count and context percentage come from `ClaudeResultEvent.message.usage`:
```typescript
interface IterationMetrics {
  iteration: number
  status: "running" | "passed" | "failed" | "timeout"
  inputTokens: number
  outputTokens: number
  totalTokens: number  // input + output
  contextPercent: number  // (totalTokens / 200000) * 100
  duration?: number  // from ClaudeResultEvent.duration_ms
}
```

### Click Behavior

Clicking an iteration card:
1. Loads events from JSONL file for that iteration
2. Replaces activity panel content with that iteration's logs
3. Highlights the selected card in sidebar
4. Shows the prompt that was sent at the top of the activity panel

## Activity Log Improvements

### Tool Calls - Expanded by Default

All tool_use events display expanded, with a collapse button to minimize:

```
┌─ Read src/services/Dashboard.ts:1-50 ──────────────────── [▼]
│  1  │ import { Effect, Ref, Layer } from "effect"
│  2  │ import { DashboardState } from "../types"
│  3  │ ...
└─────────────────────────────────────────────────────────────
```

### Syntax Highlighting

Auto-detect language from file extension in tool calls:
- `.ts`, `.tsx` → TypeScript
- `.js`, `.jsx` → JavaScript
- `.json` → JSON
- `.md` → Markdown
- `.sh`, `.bash` → Shell
- `.py` → Python
- Fallback: plain text with monospace

Use a lightweight highlighter (e.g., Prism.js or highlight.js).

### Structured Data Rendering

For JSON tool inputs/outputs, render as formatted/highlighted JSON:
```json
{
  "file_path": "/workspace/src/main.ts",
  "content": "export const main = ..."
}
```

For table-like data, render as tables when detectable.

### Collapsible Summaries

Each tool call shows a one-line summary, expandable for full content:
- `Read src/foo.ts:1-50` → expand to see file content
- `Write src/bar.ts (create)` → expand to see written content
- `Bash: npm test` → expand to see command output
- `Task: "Explore codebase"` → expand to see prompt and result

### Typography

- Monospace font throughout activity log
- Proper word wrapping for long lines
- Clear visual hierarchy (tool name, file path, content)
- Consistent spacing and padding

### Thinking Blocks

Claude's `thinking` content blocks are **hidden by default**. No toggle needed for MVP - thinking is simply not rendered.

### Prompts

The prompt sent to Claude at iteration start is displayed at the top of the activity log when viewing any iteration:

```
┌─ Prompt ───────────────────────────────────────────────────
│ You are implementing features for the ralph project...
│
│ Current features.json:
│ [{ "id": "logging", "description": "Add JSONL logging" }]
└────────────────────────────────────────────────────────────
```

## Subagent Visibility

### Limitation

Claude Code's stream-json output does **not** expose subagent internals. When Claude calls the Task tool, we only see:
1. `tool_use` event with `name: "Task"` and the prompt
2. Long pause (black box - no events)
3. `tool_result` event with the result

### What We Can Show

**During Task execution**:
```
⏳ Task: "Explore codebase for TypeScript patterns"
   Running... 42s elapsed
```

**After Task completes**:
```
✓ Task: "Explore codebase for TypeScript patterns" (47s)
  └─ Result: Found 12 files matching pattern...
```

### Implementation

Track Task tool calls and their timing:
```typescript
interface SubagentTracker {
  toolUseId: string
  prompt: string
  description: string
  startTime: number
  endTime?: number
  result?: string
}
```

When `tool_use` with `name: "Task"` arrives:
1. Create tracker entry with timestamp
2. Display spinner with prompt text and elapsed time counter

When `tool_result` with matching `tool_use_id` arrives:
1. Update tracker with end time and result
2. Display completion indicator with duration

### Post-hoc Analysis

For deeper subagent analysis, users can examine Claude's session files at `.claude/sessions/*.jsonl` after execution. This contains full subagent activity. Future enhancement: parse these files and correlate with Ralph's JSONL logs.

## Prompt Editing & Re-run

### Edit Flow

1. User clicks iteration card to view it
2. Prompt is displayed at top of activity panel with "Edit & Re-run" button
3. Clicking button opens prompt in editable textarea
4. User modifies prompt and clicks "Run"
5. New iteration N+1 is created on same branch with modified prompt
6. Activity panel switches to show new iteration's live output

### API Endpoint

```typescript
// POST /rerun
interface RerunRequest {
  prompt: string  // Modified prompt text
}

interface RerunResponse {
  iteration: number  // New iteration number
}
```

### Branch Behavior

Re-runs append to the current session branch as iteration N+1. No new branch is created. This allows for iterative prompt tuning while maintaining git history.

## State Recovery on Reconnect

When browser disconnects and reconnects:

1. Browser connects to `/events` SSE endpoint
2. Server sends current state (iteration count, running status, etc.)
3. Browser requests iteration list via `/iterations` endpoint
4. Browser displays iteration sidebar from this data
5. Browser loads current iteration's events from JSONL via `/logs/:iteration`
6. Activity panel shows restored log history

### New Endpoints

```typescript
// GET /iterations
// Returns list of iterations with metrics
interface IterationsResponse {
  iterations: IterationMetrics[]
  currentIteration: number
}

// GET /logs/:iteration
// Returns JSONL events for specific iteration
// Response: text/plain with raw JSONL content
```

## Error Display

Errors (timeouts, Claude failures, docker errors) appear inline in the activity log as special events:

```
┌─ Error ────────────────────────────────────────────────────
│ ⚠️ TimeoutError: Claude execution exceeded 10 minute limit
│
│ The iteration was terminated. No changes were committed.
└────────────────────────────────────────────────────────────
```

Iteration card status updates to show failure state (✗).

## Implementation Scope

### Phase 1: Persistence & Recovery
- [ ] LoggingService with JSONL append
- [ ] Iteration boundary markers
- [ ] `/logs/:iteration` endpoint
- [ ] Browser recovery from JSONL on reconnect

### Phase 2: Iteration Sidebar
- [ ] Iteration card component with metrics
- [ ] Token count and context % calculation
- [ ] Click to load iteration logs
- [ ] Visual status indicators

### Phase 3: Activity Log Improvements
- [ ] Tool calls expanded by default
- [ ] Syntax highlighting (Prism.js)
- [ ] Collapsible summaries
- [ ] Prompt display at iteration start
- [ ] Monospace typography overhaul

### Phase 4: Subagent Tracking
- [ ] Task tool timing tracker
- [ ] Spinner with elapsed time during Task execution
- [ ] Prompt and result display

### Phase 5: Prompt Editing
- [ ] Editable prompt textarea
- [ ] `/rerun` endpoint
- [ ] Re-run as new iteration

## Files to Modify

| File | Changes |
|------|---------|
| `src/services/Logging.ts` | NEW: LoggingService interface |
| `src/layers/LoggingLive.ts` | NEW: JSONL file writing implementation |
| `src/server.ts` | Add `/logs/:iteration`, `/iterations`, `/rerun` endpoints |
| `src/program.ts` | Emit iteration_start events, integrate LoggingService |
| `src/types.ts` | Add IterationMetrics, iteration_start event type |
| `dashboard/src/App.tsx` | New layout with iteration sidebar |
| `dashboard/src/components/IterationSidebar.tsx` | NEW: Sidebar with iteration cards |
| `dashboard/src/components/ActivityLog.tsx` | Expand by default, syntax highlighting, prompt display |
| `dashboard/src/components/ToolCall.tsx` | NEW: Formatted tool call display |
| `dashboard/src/components/SubagentIndicator.tsx` | NEW: Task execution spinner |
| `dashboard/src/hooks/useSessionRecovery.ts` | NEW: Load state from JSONL on mount |

## Out of Scope

- **Session browser**: No UI to view past sessions (use JSONL files externally)
- **Session summaries**: No auto-generated summary files
- **Cumulative token tracking**: Per-iteration only, no session totals
- **Phase-level timing**: Just Claude execution time, not docker/git overhead
- **Thinking block toggle**: Hidden by default, no toggle in MVP
- **SQLite database**: JSONL files only
- **Git diff preview**: Not included in iteration view
- **Search/filter**: No text search in activity log

## Open Questions

1. **JSONL file location**: `.ralph/sessions/` in project root vs container workspace?
   - Recommendation: Project root (outside container) for persistence
2. **Context window constant**: Hardcode 200k or make configurable?
   - Recommendation: Hardcode 200k for now, revisit if model changes
3. **Re-run prompt source**: Start from original template or last iteration's prompt?
   - Recommendation: Use the specific iteration's prompt being viewed
