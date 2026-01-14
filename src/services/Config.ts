// src/services/Config.ts
import { Context } from "effect"

export interface ConfigService {
  // Required
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

export class ConfigService extends Context.Tag("ralph/ConfigService")<
  ConfigService,
  ConfigService
>() {}
