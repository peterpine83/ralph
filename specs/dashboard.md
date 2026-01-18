# Dashboard Specification

**Files**: `src/services/Dashboard.ts` (interface), `src/layers/DashboardLive.ts` (implementation), `dashboard/`
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
│  │  ├─ POST /step-mode  → Toggle step mode                 │    │
│  │  ├─ POST /stop       → Immediate stop (kills Claude)   │    │
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

## State Management Design

### Why Effect Ref?

Before Effect, state was a mutable global variable:
- **Thread-safety issues** - Concurrent updates could race
- **Testing difficulty** - Hard to reset state between tests
- **Implicit dependencies** - Any code could mutate state

Effect `Ref` provides:
- **Immutable updates** - `Ref.update()` returns new state, never mutates
- **Thread-safe** - Effect ensures atomic updates
- **Explicit dependency** - State access requires DashboardService
- **Testable** - Test layers can provide mock state

### Why Layer.scoped?

The dashboard server needs lifecycle management:
- **Start** when dashboard is enabled
- **Stop** when program exits (cleanup)
- **Resource cleanup** - Close client connections

`Layer.scoped` provides:
- **Automatic finalization** - Server stops when scope ends
- **Error safety** - Resources cleaned up even on error
- **Composable** - Integrates with other Effect layers

See `CLAUDE.md` for the DashboardLive implementation.

## State Management

### Dashboard State
State is managed via `DashboardService.updateState()` and `DashboardService.getState()`. Updates automatically broadcast to all connected SSE clients.

State fields: `paused`, `running`, `stepMode`, `stopping`, `claudeRunning`, `containerName`, `branch`, `features`

### State Update Methods

The DashboardService interface provides:
- `updateState(partial)` - Update state and broadcast
- `broadcast(event)` - Send event to all clients
- `sendOutput(text)` - Send output event
- Convenience setters: `setRunning()`, `setPaused()`, etc.

## HTTP Endpoints

### `GET /events`
SSE stream for real-time updates.

**Response**: `text/event-stream`

### `POST /pause`
Pause the orchestrator loop. Updates state via `DashboardService.updateState({ paused: true })`.

### `POST /resume`
Resume the orchestrator loop. Updates state via `DashboardService.updateState({ paused: false })`.

### `POST /step-mode`
Toggle step mode (pause after each iteration).
- **Request**: `{ enabled: boolean }`
- **Response**: `{ stepMode: boolean }`

### `POST /stop`
Immediately stops the session by setting `stopping: true`. The orchestrator checks this flag and interrupts the current Claude execution.

### `GET /prompt`
Retrieve current prompt template from `templates/ralph-instructions.md`.

### `PUT /prompt`
Update prompt template.

### `GET /*`
Serve static dashboard files from `dashboard/dist/`.

## Server Startup

The dashboard server starts automatically when `DashboardLive` layer is provided and dashboard is enabled via ConfigService.

The server uses `Bun.serve()` with request routing to handle SSE connections, control endpoints, and static file serving. Server lifecycle is managed by `Layer.scoped`, ensuring cleanup on program exit.

## Dashboard UI (`dashboard/`)

React-based web interface built with Vite.

### Components
- **FeatureList**: Shows all features with status indicators
- **ActivityLog**: Scrolling log of Claude output
- **IterationProgress**: Current iteration / max iterations
- **Controls**: Pause/Resume buttons, Step mode toggle, Stop button

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
bun src/main.ts features.json --dashboard --dashboard-port 3847
```

### Orchestrator Integration
The orchestrator accesses dashboard functionality via `DashboardService`:
- `yield* DashboardService` to get the service
- `dashboard.updateState({ running: true, containerName, branch })`
- `dashboard.sendOutput(claudeOutputLine)`
- `dashboard.broadcast({ type: "features", data: features })`

When dashboard is disabled, operations are no-ops.

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
When a client disconnects, the broadcast method catches the error and removes the client from the set. This happens automatically within the SSE streaming implementation.

### Server Restart
Dashboard reconnects automatically via EventSource retry mechanism.

### No Dashboard Mode
When `--dashboard` is not specified:
- Server is not started
- State update functions are no-ops
- All output goes to console only
