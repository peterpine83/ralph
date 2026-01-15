// ConfigLive layer implementation
import { Layer, Effect, Config } from "effect"
import { Command } from "@effect/platform"
import { ConfigService, type IConfigService } from "../services/Config"
import { ConfigError } from "../errors"
import type { RalphArgs } from "../args"

// Type alias for consistency with spec
type CliArgs = RalphArgs

/**
 * Detect git root directory using git rev-parse
 */
const detectGitRoot = Effect.gen(function* () {
  const output = yield* Command.make("git", "rev-parse", "--show-toplevel").pipe(
    Command.string,
    Effect.mapError(() =>
      new ConfigError({
        variable: "git-root",
        message: "Not in a git repository or git command failed"
      })
    )
  )
  return output.trim()
})

/**
 * Create ConfigLive layer with CLI arguments merged with environment config
 */
export const makeConfigLive = (cliArgs: RalphArgs) =>
  Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      // Required - fail if missing
      const oauthToken = yield* Config.string("CLAUDE_CODE_OAUTH_TOKEN").pipe(
        Effect.mapError(() =>
          new ConfigError({
            variable: "CLAUDE_CODE_OAUTH_TOKEN",
            message: "Required environment variable not set"
          })
        )
      )

      // Optional with fallback
      const githubToken = yield* Config.string("GITHUB_TOKEN").pipe(
        Effect.orElse(() => Effect.succeed(""))
      )

      // Git root detection
      const gitRoot = yield* detectGitRoot

      return {
        oauthToken,
        githubToken,
        gitRoot,
        featuresPath: cliArgs.featuresPath,
        branch: cliArgs.branch,
        maxIterations: cliArgs.maxIterations,
        dashboardPort: cliArgs.dashboardPort,
        timeoutMs: 5 * 60 * 1000, // 5 minutes
        once: cliArgs.once,
        stepMode: cliArgs.step,
        dashboardEnabled: cliArgs.dashboard
      } satisfies IConfigService
    })
  )
