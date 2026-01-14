# Dashboard Specification

**Files**: `src/server.ts`, `dashboard/`
**Purpose**: Real-time web UI for monitoring Ralph sessions via Server-Sent Events (SSE)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Dashboard UI                          │    │
│  │  ├─ Features list (remaining/completed)                 │    │
│  │  ├─ Activity log (Claude output stream)                 │    │
│  │  ├─ Iteration counter                                    │    │
│  │  └─ Pause/Resume controls                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              │ EventSource (SSE)                │
│                              ▼                                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ HTTP
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     src/server.ts                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Bun.serve()                                             │    │
│  │  ├─ GET  /events     → SSE stream                       │    │
│  │  ├─ POST /pause      → Pause orchestrator               │    │
│  │  ├─ POST /resume     → Resume orchestrator              │    │
│  │  ├─ GET  /prompt     → Get prompt template              │    │
│  │  ├─ PUT  /prompt     → Update prompt template           │    │
│  │  └─ GET  /*          → Static files (dashboard UI)      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Server-Sent Events (SSE)

### Connection
```typescript
// Client (browser)
const events = new EventSource("/events")
events.onmessage = (e) => {
  const event = JSON.parse(e.data)
  handleEvent(event)
}

// Server (src/server.ts)
const clients: Set<ReadableStreamDefaultController> = new Set()

function handleEventsRequest(req: Request): Response {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller)
      // Send initial state
      controller.enqueue(`data: ${JSON.stringify({ type: "state", data: state })}\n\n`)
    },
    cancel() {
      clients.delete(controller)
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  })
}
```

### Event Types

```typescript
// src/types.ts

type DashboardEvent =
  | StateEvent
  | OutputEvent
  | FeatureEvent
  | IterationEvent
  | FeaturesEvent
  | ClaudeEventMessage

interface StateEvent {
  type: "state"
  data: DashboardState
}

interface OutputEvent {
  type: "output"
  data: string
}

interface FeatureEvent {
  type: "feature"
  data: Feature
}

interface IterationEvent {
  type: "iteration"
  data: { current: number; max: number }
}

interface FeaturesEvent {
  type: "features"
  data: Feature[]
}

interface ClaudeEventMessage {
  type: "claude"
  data: ClaudeEvent  // From claude-integration.md
}
```

### Broadcasting

```typescript
function broadcast(event: DashboardEvent) {
  const message = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients) {
    try {
      client.enqueue(message)
    } catch {
      clients.delete(client)
    }
  }
}
```

## State Management

### Dashboard State
```typescript
interface DashboardState {
  paused: boolean
  running: boolean
  containerName: string
  branch: string
  features: Feature[]
}

let state: DashboardState = {
  paused: false,
  running: false,
  containerName: "",
  branch: "",
  features: []
}
```

### State Update Functions

```typescript
function updateState(partial: Partial<DashboardState>) {
  state = { ...state, ...partial }
  broadcast({ type: "state", data: state })
}

function updateIteration(current: number, max: number) {
  broadcast({ type: "iteration", data: { current, max } })
}

function updateFeatures(features: Feature[]) {
  state.features = features
  broadcast({ type: "features", data: features })
}

function sendOutput(text: string) {
  broadcast({ type: "output", data: text })
}

function sendClaudeEvent(event: ClaudeEvent) {
  broadcast({ type: "claude", data: event })
}
```

## HTTP Endpoints

### `GET /events`
SSE stream for real-time updates.

**Response**: `text/event-stream`

### `POST /pause`
Pause the orchestrator loop.

```typescript
app.post("/pause", () => {
  state.paused = true
  broadcast({ type: "state", data: state })
  return new Response("Paused")
})
```

### `POST /resume`
Resume the orchestrator loop.

```typescript
app.post("/resume", () => {
  state.paused = false
  broadcast({ type: "state", data: state })
  return new Response("Resumed")
})
```

### `GET /prompt`
Retrieve current prompt template.

```typescript
app.get("/prompt", async () => {
  const template = await Bun.file("templates/ralph-instructions.md").text()
  return new Response(template)
})
```

### `PUT /prompt`
Update prompt template.

```typescript
app.put("/prompt", async (req) => {
  const content = await req.text()
  await Bun.write("templates/ralph-instructions.md", content)
  return new Response("Updated")
})
```

### `GET /*`
Serve static dashboard files.

```typescript
app.get("/*", (req) => {
  const path = new URL(req.url).pathname
  const file = path === "/" ? "index.html" : path.slice(1)
  return new Response(Bun.file(`dashboard/dist/${file}`))
})
```

## Server Startup

```typescript
// src/server.ts
export function startDashboardServer(port: number, distDir: string) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/events") {
        return handleEventsRequest(req)
      }

      if (url.pathname === "/pause" && req.method === "POST") {
        return handlePause()
      }

      if (url.pathname === "/resume" && req.method === "POST") {
        return handleResume()
      }

      // ... other endpoints

      // Static files
      return serveStatic(req, distDir)
    }
  })
}
```

## Dashboard UI (`dashboard/`)

React-based web interface built with Vite.

### Components
- **FeatureList**: Shows all features with status indicators
- **ActivityLog**: Scrolling log of Claude output
- **IterationProgress**: Current iteration / max iterations
- **Controls**: Pause/Resume buttons

### Technology Stack
- React 18
- Vite (build tool)
- TypeScript
- Tailwind CSS (optional)

### Build
```bash
cd dashboard
bun install
bun run build
# Output: dashboard/dist/
```

## Integration with Orchestrator

### Enabling Dashboard
```bash
bun ralph.ts features.json --dashboard --dashboard-port 3847
```

### Orchestrator Integration
```typescript
// ralph.ts
import { startDashboardServer, updateState, updateIteration, sendOutput } from "./src/server"

if (args.dashboard) {
  startDashboardServer(args.dashboardPort, "dashboard/dist")
}

// During execution
updateState({ running: true, containerName, branch })
updateIteration(iteration, args.maxIterations)
sendOutput(claudeOutputLine)
updateFeatures(remainingFeatures)
```

## Connection Lifecycle

```
1. Browser opens http://localhost:3847
2. Dashboard UI loads (static files)
3. Browser connects to /events (SSE)
4. Server sends initial state event
5. User sees current session status
6. As orchestrator runs:
   - Claude output → output events
   - Feature updates → feature events
   - Iteration changes → iteration events
7. User can pause/resume via buttons
8. On disconnect, client removed from broadcast list
```

## Error Handling

### Client Disconnect
```typescript
function broadcast(event: DashboardEvent) {
  for (const client of clients) {
    try {
      client.enqueue(...)
    } catch {
      // Client disconnected
      clients.delete(client)
    }
  }
}
```

### Server Restart
Dashboard reconnects automatically via EventSource retry mechanism.

### No Dashboard Mode
When `--dashboard` is not specified:
- Server is not started
- State update functions are no-ops
- All output goes to console only
