// Ralph error types using Effect.ts Data.TaggedError

import { Data } from "effect"

// effect-002: ConfigError - Environment variable configuration errors
export class ConfigError extends Data.TaggedError("ConfigError")<{
  variable: string
  message: string
}> {}

// effect-003: DockerError - Docker command execution failures
export class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

// effect-004: ContainerNotFoundError - Missing Docker container scenarios
export class ContainerNotFoundError extends Data.TaggedError("ContainerNotFoundError")<{
  container: string
}> {}

// effect-005: ClaudeError - Claude Code CLI failures
export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

// effect-006: TimeoutError - Operation timeout scenarios
export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string
  durationMs: number
}> {}

// effect-007: GitError - Git operation failures
export class GitError extends Data.TaggedError("GitError")<{
  operation: "clone" | "fetch" | "push" | "commit" | "checkout" | "status" | "diff" | "log" | "branch"
  stderr?: string
  cause?: unknown
}> {}

// effect-008: Additional error types

export class FeatureError extends Data.TaggedError("FeatureError")<{
  featureId: string
  message: string
  cause?: unknown
}> {}

export class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  iterations: number
  reason: string
}> {}

export class StreamError extends Data.TaggedError("StreamError")<{
  streamType: string
  message: string
  cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  message: string
  value?: unknown
}> {}

// effect-009: RalphError union type - Comprehensive error handling
export type RalphError =
  | ConfigError
  | DockerError
  | ContainerNotFoundError
  | ClaudeError
  | TimeoutError
  | GitError
  | FeatureError
  | CircuitBreakerError
  | StreamError
  | ValidationError
