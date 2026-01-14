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
  stepMode: boolean
  stopping: boolean
  claudeRunning: boolean
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
    stepMode: boolean
    stopping: boolean
    claudeRunning: boolean
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

export type DashboardEvent = StateEvent | OutputEvent | FeatureEvent | IterationEvent | FeaturesEvent | ClaudeEventMessage

// === Claude Code stream-json event types ===

export interface ClaudeEventBase {
  type: string
  subtype?: string
  session_id?: string
  timestamp?: string
}

export interface ClaudeInitEvent extends ClaudeEventBase {
  type: "system"
  subtype: "init"
  session_id: string
  tools: string[]
  mcp_servers: Record<string, unknown>[]
}

export interface ClaudeMessageEvent extends ClaudeEventBase {
  type: "assistant"
  message: {
    id: string
    type: "message"
    role: "assistant"
    content: Array<{
      type: "text" | "tool_use" | "thinking"
      text?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      thinking?: string
    }>
    model: string
    stop_reason: string | null
    stop_sequence: string | null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

export interface ClaudeResultEvent extends ClaudeEventBase {
  type: "result"
  subtype: "success" | "error"
  cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  is_error?: boolean
  num_turns?: number
  result?: string
  session_id?: string
  total_cost_usd?: number
}

// Union type for all Claude events
export type ClaudeEvent = ClaudeInitEvent | ClaudeMessageEvent | ClaudeResultEvent | ClaudeEventBase

// Dashboard event for Claude events
export interface ClaudeEventMessage {
  type: "claude_event"
  data: ClaudeEvent
}
