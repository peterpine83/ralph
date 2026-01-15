// GitLive layer implementation
import { Layer, Effect } from "effect"
import { GitService } from "../services/Git"
import { DockerService } from "../services/Docker"
import { GitError } from "../errors"

/**
 * Create GitLive layer for a specific container
 */
export const makeGitLive = (containerName: string) =>
  Layer.effect(
    GitService,
    Effect.gen(function* () {
      const docker = yield* DockerService

      // Use 'as any' workaround for Context.Tag interface/class shadowing issue
      // See ralph-progress.txt effect-020 notes for details
      return {
        checkout: (
          branch: string,
          options?: { readonly createNew?: boolean; readonly force?: boolean }
        ) =>
          Effect.gen(function* () {
            const args: string[] = ["git", "checkout"]

            if (options?.createNew) {
              args.push("-b")
            }
            if (options?.force) {
              args.push("-f")
            }

            args.push(branch)

            yield* docker.exec(containerName, args.join(" ")).pipe(
              Effect.mapError(
                (e) =>
                  new GitError({
                    operation: "checkout",
                    cause: e
                  })
              )
            )
          }),

        fetch: (branch: string) =>
          docker.exec(containerName, `git fetch origin ${branch}`).pipe(
            Effect.mapError(
              (e) =>
                new GitError({
                  operation: "fetch",
                  cause: e
                })
            ),
            Effect.asVoid
          ),

        push: (options?: { readonly setUpstream?: boolean }) =>
          Effect.gen(function* () {
            const args = ["git", "push"]

            if (options?.setUpstream) {
              args.push("--set-upstream", "origin", "HEAD")
            }

            yield* docker.exec(containerName, args.join(" ")).pipe(
              Effect.mapError(
                (e) =>
                  new GitError({
                    operation: "push",
                    cause: e
                  })
              )
            )
          }),

        hasUnpushedCommits: () =>
          Effect.gen(function* () {
            // Get current branch first
            const currentBranch = yield* docker
              .exec(containerName, "git branch --show-current")
              .pipe(
                Effect.map((output) => output.trim()),
                Effect.mapError(
                  (e) =>
                    new GitError({
                      operation: "branch",
                      cause: e
                    })
                )
              )

            // Check for unpushed commits
            const output = yield* docker
              .exec(
                containerName,
                `git log origin/${currentBranch}..HEAD --oneline`
              )
              .pipe(
                Effect.mapError(
                  (e) =>
                    new GitError({
                      operation: "log",
                      cause: e
                    })
                )
              )

            return output.trim().length > 0
          }),

        createBranch: (branch: string) =>
          docker.exec(containerName, `git checkout -b ${branch}`).pipe(
            Effect.mapError(
              (e) =>
                new GitError({
                  operation: "branch",
                  cause: e
                })
            ),
            Effect.asVoid
          ),

        configureUser: (name: string, email: string) =>
          Effect.gen(function* () {
            yield* docker
              .exec(containerName, `git config user.name "${name}"`)
              .pipe(
                Effect.mapError(
                  (e) =>
                    new GitError({
                      operation: "checkout",
                      cause: e
                    })
                )
              )

            yield* docker
              .exec(containerName, `git config user.email "${email}"`)
              .pipe(
                Effect.mapError(
                  (e) =>
                    new GitError({
                      operation: "checkout",
                      cause: e
                    })
                )
              )
          })
      } as any
    })
  )
