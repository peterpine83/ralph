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
  stepMode: boolean
  stopping: boolean
  claudeRunning: boolean
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

export interface ClaudeContentBlock {
  type: "text" | "tool_use" | "thinking"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  thinking?: string
}

export interface ClaudeMessageEvent extends ClaudeEventBase {
  type: "assistant"
  message: {
    id: string
    type: "message"
    role: "assistant"
    content: ClaudeContentBlock[]
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

export type ClaudeEvent = ClaudeInitEvent | ClaudeMessageEvent | ClaudeResultEvent | ClaudeEventBase

export type DashboardEvent =
  | { type: "state"; data: StateData }
  | { type: "iteration"; data: IterationData }
  | { type: "output"; data: OutputData }
  | { type: "features"; data: FeaturesData }
  | { type: "claude_event"; data: ClaudeEvent }
