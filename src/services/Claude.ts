import { Context, Effect, Stream } from "effect"
import type { ClaudeEvent } from "../types"

export interface ClaudeError {
  readonly _tag: "ClaudeError"
  readonly message: string
  readonly cause?: unknown
}

export interface TimeoutError {
  readonly _tag: "TimeoutError"
  readonly message: string
  readonly timeoutMs: number
}

export interface ClaudeRunOptions {
  readonly containerName: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly flags?: {
    readonly dangerouslySkipPermissions?: boolean
    readonly verbose?: boolean
    readonly outputFormat?: "stream-json" | "text"
  }
  readonly user?: string
}

export interface ClaudeService {
  readonly run: (
    options: ClaudeRunOptions
  ) => Effect.Effect<void, ClaudeError | TimeoutError>

  readonly runWithEvents: (
    options: ClaudeRunOptions
  ) => Stream.Stream<ClaudeEvent, ClaudeError | TimeoutError>
}

export class ClaudeService extends Context.Tag("ralph/ClaudeService")<
  ClaudeService,
  ClaudeService
>() {}
