import { Layer, Effect } from "effect"
import { GitService } from "../../services/Git.js"

/**
 * GitTest provides mock Git operations for testing.
 * Simulates git commands without making actual repository changes.
 */
const mockImplementation = {
  checkout: (
    _branch: string,
    _options?: { readonly createNew?: boolean; readonly force?: boolean }
  ) => Effect.succeed(undefined),

  fetch: (_branch: string) => Effect.succeed(undefined),

  push: (_options?: { readonly setUpstream?: boolean }) =>
    Effect.succeed(undefined),

  hasUnpushedCommits: () => Effect.succeed(false),

  createBranch: (_branch: string) => Effect.succeed(undefined),

  configureUser: (_name: string, _email: string) => Effect.succeed(undefined),
} as any

export const GitTest = Layer.succeed(GitService, mockImplementation)
