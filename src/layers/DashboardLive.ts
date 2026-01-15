// DashboardLive layer implementation
import { Layer, Effect, Ref } from "effect"
import { DashboardService } from "../services/Dashboard"
import type { DashboardState, DashboardEvent, Feature } from "../types"

/**
 * Create DashboardLive layer with SSE server lifecycle management
 */
export const makeDashboardLive = (initialState: DashboardState) =>
  Layer.scoped(
    DashboardService,
    Effect.gen(function* () {
      // Create mutable state reference
      const stateRef = yield* Ref.make<DashboardState>(initialState)

      // SSE clients tracking
      const clientsRef = yield* Ref.make<Set<ReadableStreamDefaultController>>(new Set())

      // Server reference (will be set when start() is called)
      const serverRef = yield* Ref.make<{ server?: ReturnType<typeof Bun.serve> }>({})

      // Helper to broadcast to all SSE clients
      const broadcastToClients = (event: DashboardEvent) =>
        Effect.gen(function* () {
          const clients = yield* Ref.get(clientsRef)
          const eventData = `data: ${JSON.stringify(event)}\n\n`

          // Send to all connected clients
          for (const controller of clients) {
            try {
              controller.enqueue(new TextEncoder().encode(eventData))
            } catch (error) {
              // Client disconnected, will be removed on next cleanup
            }
          }
        })

      // Use 'as any' workaround for Context.Tag interface/class shadowing issue
      // See ralph-progress.txt effect-020 notes for details
      const service = {
        getState: () => Ref.get(stateRef),

        updateState: (updates: Partial<DashboardState>) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, ...updates }))

            // Broadcast state change event
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setPaused: (paused: boolean) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, paused }))
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setRunning: (running: boolean) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, running }))
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setStopping: (stopping: boolean) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, stopping }))
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setStepMode: (stepMode: boolean) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, stepMode }))
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setClaudeRunning: (running: boolean) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, claudeRunning: running }))
            const newState = yield* Ref.get(stateRef)
            yield* broadcastToClients({
              type: "state",
              data: {
                paused: newState.paused,
                running: newState.running,
                stepMode: newState.stepMode,
                stopping: newState.stopping,
                claudeRunning: newState.claudeRunning,
                containerName: newState.containerName,
                branch: newState.branch,
              },
            })
          }),

        setIteration: (current: number, max: number, remaining: number) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({
              ...state,
              iteration: current,
              maxIterations: max,
            }))
            yield* broadcastToClients({
              type: "iteration",
              data: { current, max, remaining },
            })
          }),

        setFeatures: (features: Feature[]) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (state) => ({ ...state, features }))
            yield* broadcastToClients({
              type: "features",
              data: { features },
            })
          }),

        setPromptTemplate: (template: string) =>
          Ref.update(stateRef, (state) => ({ ...state, promptTemplate: template })),

        broadcast: (event: DashboardEvent) => broadcastToClients(event),

        sendOutput: (text: string) =>
          broadcastToClients({
            type: "output",
            data: { text, timestamp: Date.now() },
          }),

        start: (port: number, dashboardPath: string) =>
          Effect.gen(function* () {
            const server = Bun.serve({
              port,
              async fetch(req) {
                const url = new URL(req.url)

                // SSE endpoint
                if (url.pathname === "/events") {
                  let clientController: ReadableStreamDefaultController | null = null

                  const stream = new ReadableStream({
                    start(controller) {
                      clientController = controller

                      // Add client to tracking
                      Effect.runSync(
                        Ref.update(clientsRef, (clients) => {
                          const newClients = new Set(clients)
                          newClients.add(controller)
                          return newClients
                        })
                      )

                      // Send initial state
                      const state = Effect.runSync(Ref.get(stateRef))
                      const stateEvent: DashboardEvent = {
                        type: "state",
                        data: {
                          paused: state.paused,
                          running: state.running,
                          stepMode: state.stepMode,
                          stopping: state.stopping,
                          claudeRunning: state.claudeRunning,
                          containerName: state.containerName,
                          branch: state.branch,
                        },
                      }
                      controller.enqueue(
                        new TextEncoder().encode(`data: ${JSON.stringify(stateEvent)}\n\n`)
                      )
                    },
                    cancel() {
                      // Remove client on disconnect
                      if (clientController) {
                        Effect.runSync(
                          Ref.update(clientsRef, (clients) => {
                            const newClients = new Set(clients)
                            newClients.delete(clientController!)
                            return newClients
                          })
                        )
                      }
                    },
                  })

                  return new Response(stream, {
                    headers: {
                      "Content-Type": "text/event-stream",
                      "Cache-Control": "no-cache",
                      Connection: "keep-alive",
                      "Access-Control-Allow-Origin": "*",
                    },
                  })
                }

                // Serve dashboard static files
                const filePath = url.pathname === "/" ? "/index.html" : url.pathname
                const file = Bun.file(dashboardPath + filePath)

                if (await file.exists()) {
                  return new Response(file)
                }

                return new Response("Not Found", { status: 404 })
              },
            })

            yield* Ref.set(serverRef, { server })
          }),

        stop: () =>
          Effect.gen(function* () {
            const { server } = yield* Ref.get(serverRef)
            if (server) {
              server.stop()
            }
          }),
      } as any

      // Register cleanup finalizer to stop server when layer is released
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const { server } = yield* Ref.get(serverRef)
          if (server) {
            server.stop()
          }
        })
      )

      return service
    })
  )

export const DashboardLive = makeDashboardLive({
  paused: false,
  running: false,
  stepMode: false,
  stopping: false,
  claudeRunning: false,
  containerName: "",
  branch: "",
  iteration: 0,
  maxIterations: 0,
  features: [],
  promptTemplate: "",
})
