import { Context, Effect, Stream } from "effect"
import type { ClaudeEvent } from "../types"
import type { ClaudeError, TimeoutError } from "../errors"

/**
 * Options for Claude CLI execution
 */
export interface ClaudeRunOptions {
  /** Timeout in milliseconds (default from config) */
  timeout?: number
  /** Working directory (default: /workspace) */
  workdir?: string
}

/**
 * ClaudeService interface - manages Claude CLI execution with streaming
 *
 * This service executes Claude Code inside Docker containers, capturing
 * NDJSON event streams and handling timeouts.
 */
export interface ClaudeService {
  /**
   * Run Claude CLI command and wait for completion
   *
   * @param container - Docker container name
   * @param prompt - Prompt to pass to Claude
   * @param options - Execution options (timeout, workdir)
   * @returns Effect that completes when Claude finishes
   */
  readonly run: (
    container: string,
    prompt: string,
    options?: ClaudeRunOptions
  ) => Effect.Effect<void, ClaudeError | TimeoutError>

  /**
   * Run Claude CLI and stream NDJSON events
   *
   * @param container - Docker container name
   * @param prompt - Prompt to pass to Claude
   * @param options - Execution options (timeout, workdir)
   * @returns Stream of parsed ClaudeEvent objects
   */
  readonly runWithEvents: (
    container: string,
    prompt: string,
    options?: ClaudeRunOptions
  ) => Stream.Stream<ClaudeEvent, ClaudeError | TimeoutError>
}

/**
 * ClaudeService Context.Tag for dependency injection
 */
export class ClaudeService extends Context.Tag("ralph/ClaudeService")<
  ClaudeService,
  ClaudeService
>() {}

/**
 * Type alias for ClaudeService interface
 */
export type ClaudeServiceType = ClaudeService
