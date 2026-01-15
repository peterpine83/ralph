import { Layer } from "effect"
import { ConfigTest } from "./ConfigTest.js"
import { DockerTest } from "./DockerTest.js"
import { ClaudeTest } from "./ClaudeTest.js"
import { GitTest } from "./GitTest.js"
import { DashboardTest } from "./DashboardTest.js"

/**
 * TestLive combines all mock layers for integration testing.
 * All test layers are foundational (no dependencies between them),
 * so they can be merged together without dependency ordering.
 *
 * Usage in tests:
 * ```typescript
 * import { TestLive } from "../layers/test/index.js"
 *
 * const result = await Effect.runPromise(
 *   myEffect.pipe(Effect.provide(TestLive))
 * )
 * ```
 */
export const TestLive = Layer.mergeAll(
  ConfigTest,
  DockerTest,
  GitTest,
  ClaudeTest,
  DashboardTest
)

// Re-export individual test layers for granular testing
export { ConfigTest } from "./ConfigTest.js"
export { DockerTest } from "./DockerTest.js"
export { ClaudeTest } from "./ClaudeTest.js"
export { GitTest } from "./GitTest.js"
export { DashboardTest } from "./DashboardTest.js"
