// Configuration service for Ralph orchestrator
import { Context } from "effect"

export interface ConfigService {
  readonly oauthToken: string
  readonly gitRoot: string
  readonly githubToken: string
  readonly featuresPath: string
}

export class ConfigService extends Context.Tag("ralph/ConfigService")<
  ConfigService,
  ConfigService
>() {}
