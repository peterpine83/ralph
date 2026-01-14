import { Context } from "effect"

/**
 * ConfigService provides type-safe configuration from environment variables and CLI arguments.
 * This is a read-only service that combines environment configuration with CLI overrides.
 */
interface ConfigService {
  // Required fields (no defaults)
  readonly oauthToken: string
  readonly gitRoot: string

  // With defaults
  readonly githubToken: string              // default: ""
  readonly featuresPath: string             // default: "features.json"
  readonly branch: string | undefined       // default: auto-generated
  readonly maxIterations: number            // default: 5
  readonly dashboardPort: number            // default: 3847
  readonly timeoutMs: number                // default: 300000 (5 min)

  // Flags
  readonly once: boolean                    // default: false
  readonly stepMode: boolean                // default: false
  readonly dashboardEnabled: boolean        // default: false
}

/**
 * ConfigService Context.Tag for dependency injection.
 * Use this to access configuration in Effect programs via yield* ConfigService.
 */
class ConfigService extends Context.Tag("ralph/ConfigService")<
  ConfigService,
  ConfigService
>() {}

export { ConfigService }
export type { ConfigService as ConfigServiceType }
