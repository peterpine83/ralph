import { Context, Effect } from "effect"

export interface GitError {
  readonly _tag: "GitError"
  readonly message: string
  readonly cause?: unknown
}

export interface GitService {
  readonly checkout: (
    branch: string,
    options?: { readonly createNew?: boolean; readonly force?: boolean }
  ) => Effect.Effect<void, GitError>

  readonly fetch: (branch: string) => Effect.Effect<void, GitError>

  readonly push: (options?: {
    readonly setUpstream?: boolean
  }) => Effect.Effect<void, GitError>

  readonly hasUnpushedCommits: () => Effect.Effect<boolean, GitError>

  readonly createBranch: (
    branch: string
  ) => Effect.Effect<void, GitError>

  readonly configureUser: (
    name: string,
    email: string
  ) => Effect.Effect<void, GitError>
}

export class GitService extends Context.Tag("ralph/GitService")<
  GitService,
  GitService
>() {}
