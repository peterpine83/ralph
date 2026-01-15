import { Layer, Effect, Stream } from "effect"
import { ClaudeService, type ClaudeRunOptions } from "../../services/Claude.js"

/**
 * ClaudeTest provides mock Claude operations for testing.
 * Simulates Claude API interactions without making actual API calls.
 */
const mockImplementation = {
  run: (_options: ClaudeRunOptions) =>
    Effect.succeed(undefined),

  runWithEvents: (_options: ClaudeRunOptions) =>
    Stream.make(
      { type: "output" as const, text: "Mock Claude output" },
      { type: "completion" as const }
    ),
} as any

export const ClaudeTest = Layer.succeed(ClaudeService, mockImplementation)
