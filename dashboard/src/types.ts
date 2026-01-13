// Dashboard types (mirrors ../src/types.ts)

export interface Feature {
  id: string
  description: string
  passes: boolean
  verify_command?: string
}

export interface StateData {
  paused: boolean
  running: boolean
  containerName: string
  branch: string
}

export interface IterationData {
  current: number
  max: number
  remaining: number
}

export interface OutputData {
  text: string
  timestamp: number
}

export interface FeaturesData {
  features: Feature[]
}

export type DashboardEvent =
  | { type: "state"; data: StateData }
  | { type: "iteration"; data: IterationData }
  | { type: "output"; data: OutputData }
  | { type: "features"; data: FeaturesData }
