// src/errors/index.ts
import { Data } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  variable: string
  message: string
}> {}

export class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

export class ContainerNotFoundError extends Data.TaggedError("ContainerNotFoundError")<{
  container: string
}> {}

export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string
  durationMs: number
}> {}

export class GitError extends Data.TaggedError("GitError")<{
  operation: "fetch" | "push" | "checkout" | "log" | "createBranch" | "config"
  stderr?: string
  cause?: unknown
}> {}

export class FeatureError extends Data.TaggedError("FeatureError")<{
  path: string
  message: string
  cause?: unknown
}> {}

export class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  iterations: number
  message: string
}> {}

export class StreamError extends Data.TaggedError("StreamError")<{
  message: string
  line?: string
  cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  value: unknown
  message: string
}> {}

// Union type for all Ralph errors
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
