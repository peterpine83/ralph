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

## Output Parsing

### Stream Processing
```typescript
// ralph.ts - runClaudeInContainer()

const proc = Bun.spawn(["docker", "exec", "-u", "node", container, "claude", ...])
const reader = proc.stdout.getReader()
const decoder = new TextDecoder()
let buffer = ""

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split("\n")
  buffer = lines.pop() || ""  // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      handleClaudeEvent(event)
    } catch {
      // Not JSON - treat as raw output
      console.log(line)
    }
  }
}
```

### Event Handling
```typescript
function handleClaudeEvent(event: ClaudeEvent) {
  switch (event.type) {
    case "system":
      console.log(`Session: ${event.session_id}`)
      break

    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text") {
          console.log(block.text)
        } else if (block.type === "tool_use") {
          console.log(`[Tool: ${block.name}]`)
        }
      }
      break

    case "result":
      console.log(`Cost: $${event.cost_usd.toFixed(4)}`)
      console.log(`Duration: ${(event.duration_ms / 1000).toFixed(1)}s`)
      break
  }

  // Forward to dashboard if enabled
  sendClaudeEvent(event)
}
```

## Timeout Handling

Claude is killed after 5 minutes to prevent runaway sessions:

```typescript
const TIMEOUT_MS = 5 * 60 * 1000

const controller = new AbortController()
const timeout = setTimeout(() => {
  controller.abort()
}, TIMEOUT_MS)

try {
  const proc = Bun.spawn([...], { signal: controller.signal })
  // ... process output
} catch (e) {
  if (e instanceof Error && e.name === "AbortError") {
    console.log("TIMEOUT: Claude killed after 5 minutes")
    // Kill container process
    await Bun.$`docker exec ${container} pkill -f claude`.nothrow()
  }
  throw e
} finally {
  clearTimeout(timeout)
}
```

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

Claude events are forwarded to connected dashboard clients:

```typescript
// src/server.ts
function sendClaudeEvent(event: ClaudeEvent) {
  broadcast({
    type: "claude",
    data: event
  })
}
```

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
