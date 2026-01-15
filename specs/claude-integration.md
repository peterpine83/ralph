# Claude Integration Specification

**Purpose**: Invoke Claude Code CLI inside container and parse its structured output

## CLI Invocation

### Command Structure
```bash
docker exec -u node <container> \
  claude -p \
  --dangerously-skip-permissions \
  --verbose \
  --output-format stream-json \
  "<prompt>"
```

### Flag Reference

| Flag | Purpose |
|------|---------|
| `-p` | Print mode (non-interactive) |
| `--dangerously-skip-permissions` | Skip permission checks (required for non-root) |
| `--verbose` | Enable detailed logging |
| `--output-format stream-json` | Output as newline-delimited JSON events |

### Prompt Delivery

The prompt is passed as a command-line argument. For complex prompts, Ralph writes to `.ralph-prompt.md` and instructs Claude to read it:

```bash
claude -p ... "Read .ralph-prompt.md and follow the instructions."
```

## Stream-JSON Output Format

Claude outputs newline-delimited JSON (NDJSON) with typed events:

### Event Types

```typescript
// src/types.ts

// Initial system event
interface ClaudeInitEvent {
  type: "system"
  subtype: "init"
  session_id: string
  tools: string[]
  mcp_servers: string[]
}

// Assistant message (Claude's response)
interface ClaudeMessageEvent {
  type: "assistant"
  message: {
    id: string
    type: "message"
    role: "assistant"
    content: ContentBlock[]
    model: string
    stop_reason: string
    usage: {
      input_tokens: number
      output_tokens: number
    }
  }
}

// Content block types
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object }
  | { type: "tool_result"; tool_use_id: string; content: string }

// Final result event
interface ClaudeResultEvent {
  type: "result"
  subtype: "success" | "error" | "interrupted"
  cost_usd: number
  duration_ms: number
  is_error: boolean
  num_turns: number
  session_id: string
}
```

### Example Output Stream

```json
{"type":"system","subtype":"init","session_id":"abc123","tools":["Read","Write","Bash"],"mcp_servers":[]}
{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":"I'll read the prompt file..."}]}}
{"type":"assistant","message":{"id":"msg_2","content":[{"type":"tool_use","name":"Read","input":{"path":".ralph-prompt.md"}}]}}
{"type":"assistant","message":{"id":"msg_3","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"assistant","message":{"id":"msg_4","content":[{"type":"text","text":"I'll implement the feature..."}]}}
{"type":"result","subtype":"success","cost_usd":0.05,"duration_ms":45000,"is_error":false,"num_turns":12}
```

## Stream Processing Design

Ralph uses Effect Stream for NDJSON parsing instead of manual buffer management.

### Why Effect Stream?

Manual stream handling has several issues:
- **Manual buffer management** - Must track incomplete lines across chunks
- **No guaranteed cleanup** - Reader.releaseLock() easily forgotten
- **Error handling mixed with business logic** - Try-catch interleaved with parsing
- **Type safety relies on casts** - JSON.parse returns unknown

Effect Stream provides:
- **Automatic cleanup** - Resources released when stream ends or errors
- **Backpressure** - Consumer controls flow, preventing memory issues
- **Composition** - Streams compose cleanly with map, filter, flatMap
- **Typed errors** - StreamError propagates through pipeline

### Error Recovery

Invalid JSON lines produce `StreamError` but don't abort the stream. The implementation skips invalid lines and continues parsing, allowing Claude output with mixed JSON/text to be processed.

See `CLAUDE.md` for the `parseNDJSON` implementation in `src/streams/ndjson.ts`.

## Output Parsing

The `ClaudeService.runWithEvents()` method returns a `Stream<ClaudeEvent, ClaudeError>` that emits typed events as Claude produces output. Events are:

- **system/init** - Session started, lists available tools
- **assistant** - Claude's response with content blocks (text, tool_use, tool_result)
- **result** - Final summary with cost, duration, success/error status

Events are forwarded to `DashboardService.broadcast()` for real-time display.

## Timeout Handling

Claude is killed after a configurable timeout (default 10 minutes) to prevent runaway sessions.

`ClaudeService.runWithEvents()` applies `Effect.timeout()` to the stream pipeline. When timeout triggers:
1. A `TimeoutError` is produced with operation name and duration
2. The underlying process is terminated via Effect's interruption model
3. Resources are cleaned up automatically by Effect

The orchestrator catches `TimeoutError` and increments the no-change counter, then continues to the next iteration.

## Prompt Template

Located at `templates/ralph-instructions.md`:

```markdown
# Ralph Instructions

You are working on implementing features for this project.

## Your Task
1. Read `features.json` to see remaining work
2. Read `ralph-progress.txt` for context from previous iterations
3. Choose ONE feature to implement (consider dependencies)
4. Implement the feature
5. Run the verify_command if present
6. If verification passes:
   - Update features.json: set passes: true
   - Update ralph-progress.txt with learnings
   - Commit: "Feature: {id} - {description}"
   - Push to the current branch
7. EXIT - do not continue to the next feature

## Important Rules
- Implement only ONE feature per session
- Always verify before marking complete
- Commit and push your changes
- Exit after completing one feature
```

## Claude's Capabilities

Inside the container, Claude can:

| Capability | How |
|------------|-----|
| Read files | Built-in `Read` tool |
| Write files | Built-in `Write` tool |
| Run commands | Built-in `Bash` tool |
| Git operations | Via bash (git add, commit, push) |
| Install packages | Via bash (npm install, bun add) |
| Run tests | Via bash (npm test, bun test) |

Claude cannot:
- Access network beyond whitelist
- Escape container
- Access host filesystem
- Persist state between iterations (except via git)

## Error Scenarios

| Scenario | Behavior |
|----------|----------|
| Claude crashes | Orchestrator continues to next iteration |
| Claude times out | Process killed, noChangeCount incremented |
| Invalid JSON output | Line treated as raw text |
| Claude exits with error | Result event has `is_error: true` |
| Tool execution fails | Claude retries or reports failure |

## Dashboard Integration

Claude events are forwarded to connected dashboard clients via `DashboardService.broadcast()`.

The dashboard uses these events to:
- Display Claude's thinking in real-time
- Show tool usage
- Track cost and duration
- Visualize progress

## Cost Tracking

The final `result` event includes cost information:

```json
{
  "type": "result",
  "cost_usd": 0.0523,
  "duration_ms": 47832,
  "num_turns": 15
}
```

This can be aggregated across iterations for total session cost.
