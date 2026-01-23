import { Layer } from "effect"
import { ConfigService } from "../../services/Config.js"

/**
 * ConfigTest provides mock configuration values for testing.
 * Uses realistic defaults that work in test environments.
 */
export const ConfigTest = Layer.succeed(
  ConfigService,
  ConfigService.of({
    // Required fields with test values
    oauthToken: "test-oauth-token-12345",
    gitRoot: "/tmp/test-repo",

    // Optional fields with sensible test defaults
    githubToken: "test-github-token-67890",
    featuresPath: ".ralph/features.json",
    branch: "test/ralph-branch",
    maxIterations: 3,
    dashboardPort: 13847,
    timeoutMs: 10000, // 10 seconds for fast tests

    // Boolean flags
    once: false,
    stepMode: false,
    dashboardEnabled: false,

    // Mode
    mode: "build",
  })
)
