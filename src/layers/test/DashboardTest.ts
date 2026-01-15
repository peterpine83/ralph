import { Layer, Effect } from "effect"
import { DashboardService } from "../../services/Dashboard.js"
import type { DashboardState, Feature, DashboardEvent } from "../../types.js"

/**
 * DashboardTest provides mock Dashboard operations for testing.
 * Manages in-memory dashboard state without starting a real HTTP server.
 */

// Initial mock state
const initialState: DashboardState = {
  paused: false,
  running: false,
  stepMode: false,
  stopping: false,
  claudeRunning: false,
  containerName: "mock-container",
  branch: "test/mock-branch",
  iteration: 1,
  maxIterations: 3,
  features: [],
  promptTemplate: "mock prompt template",
}

const mockImplementation = {
  // State management methods
  getState: () => Effect.succeed(initialState),

  updateState: (_updates: Partial<DashboardState>) =>
    Effect.succeed(undefined),

  // Convenience setters for common state changes
  setPaused: (_paused: boolean) => Effect.succeed(undefined),

  setRunning: (_running: boolean) => Effect.succeed(undefined),

  setStopping: (_stopping: boolean) => Effect.succeed(undefined),

  setStepMode: (_stepMode: boolean) => Effect.succeed(undefined),

  setClaudeRunning: (_running: boolean) => Effect.succeed(undefined),

  setIteration: (_current: number, _max: number, _remaining: number) =>
    Effect.succeed(undefined),

  setFeatures: (_features: Feature[]) => Effect.succeed(undefined),

  setPromptTemplate: (_template: string) => Effect.succeed(undefined),

  // Broadcasting methods
  broadcast: (_event: DashboardEvent) => Effect.succeed(undefined),

  sendOutput: (_text: string) => Effect.succeed(undefined),

  // Lifecycle methods
  start: (_port: number, _dashboardPath: string) => Effect.succeed(undefined),

  stop: () => Effect.succeed(undefined),
} as any

export const DashboardTest = Layer.succeed(DashboardService, mockImplementation)
