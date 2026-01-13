// Dashboard SSE server for Ralph orchestrator

import type { DashboardState, DashboardEvent, Feature } from "./types"

// Connected SSE clients
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()

// Dashboard state (mutable, updated by orchestrator)
const state: DashboardState = {
  paused: false,
  running: false,
  containerName: "",
  branch: "",
  iteration: 0,
  maxIterations: 5,
  features: [],
  promptTemplate: "",
}

// Broadcast event to all connected clients
function broadcast(event: DashboardEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`
  const encoded = new TextEncoder().encode(data)
  for (const client of clients) {
    try {
      client.enqueue(encoded)
    } catch {
      clients.delete(client)
    }
  }
}

// Public API for orchestrator
export function updateState(updates: Partial<DashboardState>): void {
  Object.assign(state, updates)
  broadcast({
    type: "state",
    data: {
      paused: state.paused,
      running: state.running,
      containerName: state.containerName,
      branch: state.branch,
    },
  })
}

export function updateIteration(current: number, max: number, remaining: number): void {
  state.iteration = current
  state.maxIterations = max
  broadcast({
    type: "iteration",
    data: { current, max, remaining },
  })
}

export function updateFeatures(features: Feature[]): void {
  state.features = features
  broadcast({
    type: "features",
    data: { features },
  })
}

export function sendOutput(text: string): void {
  broadcast({
    type: "output",
    data: { text, timestamp: Date.now() },
  })
}

export function isPaused(): boolean {
  return state.paused
}

export function setPromptTemplate(template: string): void {
  state.promptTemplate = template
}

// Create SSE stream
function createSSEStream(): ReadableStream<Uint8Array> {
  let controller: ReadableStreamDefaultController<Uint8Array>

  return new ReadableStream({
    start(c) {
      controller = c
      clients.add(controller)

      // Send initial state
      const initEvents: DashboardEvent[] = [
        {
          type: "state",
          data: {
            paused: state.paused,
            running: state.running,
            containerName: state.containerName,
            branch: state.branch,
          },
        },
        {
          type: "iteration",
          data: {
            current: state.iteration,
            max: state.maxIterations,
            remaining: state.features.filter(f => !f.passes).length,
          },
        },
        {
          type: "features",
          data: { features: state.features },
        },
      ]

      for (const event of initEvents) {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(new TextEncoder().encode(data))
      }
    },
    cancel() {
      clients.delete(controller)
    },
  })
}

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

// Serve static file from dashboard dist
async function serveStaticFile(distDir: string, pathname: string): Promise<Response> {
  const filePath = pathname === "/" || pathname === "/index.html"
    ? `${distDir}/index.html`
    : `${distDir}${pathname}`

  try {
    const file = Bun.file(filePath)
    if (!await file.exists()) {
      return new Response("Not found", { status: 404 })
    }

    const ext = filePath.substring(filePath.lastIndexOf("."))
    const contentType = MIME_TYPES[ext] || "application/octet-stream"

    return new Response(file, {
      headers: { "Content-Type": contentType },
    })
  } catch {
    return new Response("Dashboard not found. Run: cd dashboard && bun install && bun run build", {
      status: 404,
    })
  }
}

// Start dashboard server
export function startDashboardServer(port: number, dashboardPath: string): void {
  // Extract dist directory from the index.html path
  const distDir = dashboardPath.replace(/\/index\.html$/, "")

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)

      // SSE endpoint
      if (url.pathname === "/events") {
        return new Response(createSSEStream(), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        })
      }

      // Pause endpoint
      if (url.pathname === "/pause" && req.method === "POST") {
        state.paused = true
        broadcast({
          type: "state",
          data: {
            paused: state.paused,
            running: state.running,
            containerName: state.containerName,
            branch: state.branch,
          },
        })
        return new Response(JSON.stringify({ paused: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      // Resume endpoint
      if (url.pathname === "/resume" && req.method === "POST") {
        state.paused = false
        broadcast({
          type: "state",
          data: {
            paused: state.paused,
            running: state.running,
            containerName: state.containerName,
            branch: state.branch,
          },
        })
        return new Response(JSON.stringify({ paused: false }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      // Get prompt template
      if (url.pathname === "/prompt" && req.method === "GET") {
        return new Response(JSON.stringify({ template: state.promptTemplate }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      // Update prompt template
      if (url.pathname === "/prompt" && req.method === "PUT") {
        return (async () => {
          const body = await req.json() as { template: string }
          state.promptTemplate = body.template
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          })
        })()
      }

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
      }

      // Serve static files from dashboard dist
      return serveStaticFile(distDir, url.pathname)
    },
  })

  console.log(`Dashboard available at http://localhost:${port}`)
}
