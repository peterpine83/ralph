// ClaudeLive layer implementation
import { Layer, Effect, Stream, Duration } from "effect"
import { ClaudeService, type ClaudeRunOptions } from "../services/Claude"
import { DockerService } from "../services/Docker"
import { ClaudeError, TimeoutError } from "../errors"

/**
 * Create ClaudeLive layer
 */
export const makeClaudeLive = () =>
  Layer.effect(
    ClaudeService,
    Effect.gen(function* () {
      const docker = yield* DockerService

      // Use 'as any' workaround for Context.Tag interface/class shadowing issue
      // See ralph-progress.txt effect-020 notes for details
      return {
        run: (options: ClaudeRunOptions) =>
          Effect.gen(function* () {
            // Build claude CLI command with flags
            const args: string[] = ["claude", "-p"]

            if (options.flags?.dangerouslySkipPermissions) {
              args.push("--dangerously-skip-permissions")
            }

            if (options.flags?.verbose) {
              args.push("--verbose")
            }

            if (options.flags?.outputFormat) {
              args.push("--output-format", options.flags.outputFormat)
            }

            args.push(`"${options.prompt}"`)

            const command = args.join(" ")

            // Execute with timeout
            yield* docker
              .exec(options.containerName, command, {
                user: options.user
              })
              .pipe(
                Effect.timeout(Duration.millis(options.timeoutMs)),
                Effect.mapError((e) => {
                  // Check if it's a timeout error
                  if (e._tag === "TimeoutException") {
                    return new TimeoutError({
                      operation: "claude run",
                      durationMs: options.timeoutMs
                    })
                  }
                  // Otherwise it's a docker/command error
                  return new ClaudeError({
                    cause: e
                  })
                }),
                Effect.asVoid
              )
          }),

        runWithEvents: (_options: ClaudeRunOptions) =>
          Stream.fromEffect(Effect.fail(new Error("Not implemented")))
      } as any
    })
  )
