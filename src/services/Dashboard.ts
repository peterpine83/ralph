import { Context, Effect } from "effect"
import type { DashboardState, DashboardEvent, Feature } from "../types"

export interface DashboardError {
  readonly _tag: "DashboardError"
  readonly message: string
  readonly cause?: unknown
}

export interface DashboardService {
  // State management methods
  readonly getState: () => Effect.Effect<DashboardState, DashboardError>

  readonly updateState: (
    updates: Partial<DashboardState>
  ) => Effect.Effect<void, DashboardError>

  // Convenience setters for common state changes
  readonly setPaused: (paused: boolean) => Effect.Effect<void, DashboardError>

  readonly setRunning: (running: boolean) => Effect.Effect<void, DashboardError>

  readonly setStopping: (stopping: boolean) => Effect.Effect<void, DashboardError>

  readonly setStepMode: (stepMode: boolean) => Effect.Effect<void, DashboardError>

  readonly setClaudeRunning: (running: boolean) => Effect.Effect<void, DashboardError>

  readonly setIteration: (
    current: number,
    max: number,
    remaining: number
  ) => Effect.Effect<void, DashboardError>

  readonly setFeatures: (features: Feature[]) => Effect.Effect<void, DashboardError>

  readonly setPromptTemplate: (template: string) => Effect.Effect<void, DashboardError>

  // Broadcasting methods
  readonly broadcast: (event: DashboardEvent) => Effect.Effect<void, DashboardError>

  readonly sendOutput: (text: string) => Effect.Effect<void, DashboardError>

  // Lifecycle methods
  readonly start: (port: number, dashboardPath: string) => Effect.Effect<void, DashboardError>

  readonly stop: () => Effect.Effect<void, DashboardError>
}

export class DashboardService extends Context.Tag("ralph/DashboardService")<
  DashboardService,
  DashboardService
>() {}
