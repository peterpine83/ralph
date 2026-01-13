// Shared types for Ralph dashboard

export interface Feature {
  id: string
  description: string
  passes: boolean
  verify_command?: string
}

export interface DashboardState {
  paused: boolean
  running: boolean
  containerName: string
  branch: string
  iteration: number
  maxIterations: number
  features: Feature[]
  promptTemplate: string
}

// SSE event types
export interface StateEvent {
  type: "state"
  data: {
    paused: boolean
    running: boolean
    containerName: string
    branch: string
  }
}

export interface OutputEvent {
  type: "output"
  data: {
    text: string
    timestamp: number
  }
}

export interface FeatureEvent {
  type: "feature"
  data: {
    id: string
    status: "pending" | "working" | "passed"
  }
}

export interface IterationEvent {
  type: "iteration"
  data: {
    current: number
    max: number
    remaining: number
  }
}

export interface FeaturesEvent {
  type: "features"
  data: {
    features: Feature[]
  }
}

export type DashboardEvent = StateEvent | OutputEvent | FeatureEvent | IterationEvent | FeaturesEvent
