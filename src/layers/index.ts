// Layer composition
import { Layer } from "effect"
import { makeConfigLive } from "./ConfigLive"
import { DockerLive } from "./DockerLive"
import { makeClaudeLive } from "./ClaudeLive"
import { makeGitLive } from "./GitLive"
import { makeDashboardLive } from "./DashboardLive"
import type { RalphArgs } from "../args"
import type { DashboardState } from "../types"

// Type alias for consistency with spec
type CliArgs = RalphArgs

/**
 * Main production layer composition
 *
 * Composes all layers with proper dependency order:
 * 1. ConfigLive - foundational layer (no dependencies)
 * 2. DockerLive - depends on ConfigService
 * 3. GitLive - depends on DockerService
 * 4. ClaudeLive - depends on DockerService and ConfigService
 * 5. DashboardLive - depends on ConfigService
 *
 * @param cliArgs - Command-line arguments for configuration
 * @param containerName - Docker container name for Git operations
 * @param initialState - Initial dashboard state
 */
export const MainLive = (
  cliArgs: CliArgs,
  containerName: string,
  initialState: DashboardState
) =>
  Layer.mergeAll(
    makeConfigLive(cliArgs),
    DockerLive,
    makeGitLive(containerName)
  ).pipe(
    Layer.provideMerge(makeClaudeLive()),
    Layer.provideMerge(makeDashboardLive(initialState))
  )

// Re-export individual layer factories for testing and custom composition
export { makeConfigLive } from "./ConfigLive"
export { DockerLive } from "./DockerLive"
export { makeClaudeLive } from "./ClaudeLive"
export { makeGitLive } from "./GitLive"
export { makeDashboardLive } from "./DashboardLive"
