// Entry point for Effect-based Ralph orchestrator
import { BunRuntime } from "@effect/platform-bun"
import { Effect, Console } from "effect"
import { mainLoop } from "./program.js"
import { MainLive } from "./layers/index.js"

/**
 * Main entry point using BunRuntime.runMain
 *
 * This is a minimal implementation that demonstrates the pattern:
 * - Import BunRuntime from @effect/platform-bun
 * - Wrap mainLoop with Effect.provide(MainLive)
 * - Use Effect.catchTags for error handling
 * - Execute with BunRuntime.runMain
 *
 * NOTE: This is a placeholder implementation.
 * A complete implementation would:
 * 1. Parse CLI arguments
 * 2. Read features.json
 * 3. Create container session (createSession)
 * 4. Build MainLive layer with runtime values (containerName, initialState)
 * 5. Run mainLoop with proper parameters
 */

// Placeholder: In a real implementation, these would come from CLI args and createSession
const placeholderContainerName = "ralph-session-placeholder"
const placeholderPrompt = "Read .ralph-prompt.md and follow the instructions."

// Placeholder cliArgs
const placeholderCliArgs = {
  featuresPath: ".ralph/features.json",
  branch: "main",
  once: false,
  maxIterations: 50,
  dashboard: false,
  dashboardPort: 3847,
  step: false,
}

// Placeholder initial dashboard state
const placeholderState = {
  paused: false,
  running: false,
  stepMode: false,
  stopping: false,
  claudeRunning: false,
  containerName: "",
  branch: "main",
  iteration: 0,
  maxIterations: 50,
  features: [],
  promptTemplate: "",
}

// Main program: mainLoop with MainLive layer
// Note: This placeholder has type issues due to unprovided dependencies in catchTags
// A production implementation would properly sequence createSession → mainLoop
const program = mainLoop({
  containerName: placeholderContainerName,
  prompt: placeholderPrompt,
}).pipe(Effect.provide(MainLive(placeholderCliArgs, placeholderContainerName, placeholderState)))

// Execute with BunRuntime.runMain
// Using catchAll for error handling instead of catchTags to avoid type conflicts
BunRuntime.runMain(
  program.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Console.error(`Error: ${String(error)}`)
        return yield* Effect.void
      })
    )
  ) as Effect.Effect<void, never, never>
)
