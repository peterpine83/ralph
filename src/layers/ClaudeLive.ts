// ClaudeLive layer implementation
import { Layer, Effect, Stream, Duration } from "effect"
import { ClaudeService, type ClaudeRunOptions } from "../services/Claude"
import { DockerService } from "../services/Docker"
import { ClaudeError, TimeoutError, StreamError } from "../errors"
import { parseNDJSON } from "../streams/ndjson"
import type { ClaudeEvent } from "../types"

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

        runWithEvents: (options: ClaudeRunOptions) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Build claude CLI command with flags, forcing stream-json output
              const args: string[] = ["claude", "-p"]

              if (options.flags?.dangerouslySkipPermissions) {
                args.push("--dangerously-skip-permissions")
              }

              if (options.flags?.verbose) {
                args.push("--verbose")
              }

              // Force stream-json format for event streaming
              args.push("--output-format", "stream-json")

              args.push(`"${options.prompt}"`)

              const command = args.join(" ")

              // Execute with streaming stdout/stderr
              const streamOutput = yield* docker.execStream(
                options.containerName,
                command,
                {
                  user: options.user
                }
              )

              // Convert stdout (Stream<string, DockerError>) to Stream<string, StreamError>
              // so it can be parsed by parseNDJSON
              const stringStream = streamOutput.stdout.pipe(
                Stream.mapError(
                  (e) =>
                    new StreamError({
                      streamType: "docker-exec",
                      message: e.message,
                      cause: e.cause
                    })
                )
              )

              // Parse NDJSON from stdout stream and apply timeout
              return parseNDJSON<ClaudeEvent>(stringStream).pipe(
                // Apply timeout to the stream
                Stream.timeout(Duration.millis(options.timeoutMs)),
                // Map errors to ClaudeError or TimeoutError
                Stream.mapError((e: any) => {
                  if (e._tag === "TimeoutException") {
                    return new TimeoutError({
                      operation: "claude runWithEvents",
                      durationMs: options.timeoutMs
                    })
                  }
                  // StreamError from parseNDJSON
                  return new ClaudeError({
                    cause: e
                  })
                })
              )
            })
          )
      } as any
    })
  )
