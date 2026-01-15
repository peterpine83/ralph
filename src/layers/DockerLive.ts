// DockerLive layer implementation
import { Layer, Effect, Stream } from "effect"
import { Command } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import { DockerService, type IDockerService } from "../services/Docker"
import { DockerError } from "../errors"
import type { ContainerConfig, ContainerInfo } from "../services/Docker"

/**
 * DockerLive layer - implements DockerService using @effect/platform Command
 * Provides BunContext.layer for CommandExecutor
 */
const implementation = {
    create: (config: ContainerConfig) =>
      Effect.gen(function* () {
        // Build docker create command arguments
        const args = [
          "create",
          "--name",
          config.name
        ]

        // Add capabilities if specified
        if (config.capAdd) {
          for (const cap of config.capAdd) {
            args.push("--cap-add", cap)
          }
        }

        // Add environment variables if specified
        if (config.env) {
          for (const envVar of config.env) {
            args.push("-e", envVar)
          }
        }

        // Add volumes if specified
        if (config.volumes) {
          for (const volume of config.volumes) {
            args.push("-v", volume)
          }
        }

        // Add workdir if specified
        if (config.workdir) {
          args.push("-w", config.workdir)
        }

        // Add user if specified
        if (config.user) {
          args.push("-u", config.user)
        }

        // Image and keep-alive command
        args.push(config.image, "tail", "-f", "/dev/null")

        // Execute docker create command
        const containerId = yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "create",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        return containerId
      }),

    start: (containerName: string) =>
      Effect.gen(function* () {
        yield* Command.make("docker", "start", containerName).pipe(
          Command.string,
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "start",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )
      }),

    remove: (containerName: string, force = false) =>
      Effect.gen(function* () {
        // Build docker rm command arguments
        const args = ["rm"]
        if (force) {
          args.push("-f")
        }
        args.push(containerName)

        yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "remove",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )
      }),

    inspect: (containerName: string) =>
      Effect.gen(function* () {
        // Get running state
        const runningOutput = yield* Command.make(
          "docker",
          "inspect",
          "-f",
          "{{.State.Running}}",
          containerName
        ).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "inspect",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        // Get status
        const statusOutput = yield* Command.make(
          "docker",
          "inspect",
          "-f",
          "{{.State.Status}}",
          containerName
        ).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "inspect",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        // Get ID
        const idOutput = yield* Command.make(
          "docker",
          "inspect",
          "-f",
          "{{.Id}}",
          containerName
        ).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "inspect",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        return {
          id: idOutput,
          name: containerName,
          running: runningOutput === "true",
          status: statusOutput
        } satisfies ContainerInfo
      }),
    exec: (containerName: string, command: string, options?: { readonly user?: string; readonly workdir?: string; readonly env?: ReadonlyArray<string> }) =>
      Effect.gen(function* () {
        // Build docker exec command arguments
        const args = ["exec"]

        // Add user option if specified
        if (options?.user) {
          args.push("-u", options.user)
        }

        // Add workdir option if specified
        if (options?.workdir) {
          args.push("-w", options.workdir)
        }

        // Add environment variables if specified
        if (options?.env) {
          for (const envVar of options.env) {
            args.push("-e", envVar)
          }
        }

        // Add container name and command
        args.push(containerName, "sh", "-c", command)

        // Execute docker exec command and return output
        const output = yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "exec",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        return output
      }),
    execStream: (containerName: string, command: string, options?: { readonly user?: string; readonly workdir?: string; readonly env?: ReadonlyArray<string> }) =>
      Effect.scoped(
        Effect.gen(function* () {
          // Build docker exec command arguments
          const args = ["exec", "-i"]

          // Add user option if specified
          if (options?.user) {
            args.push("-u", options.user)
          }

          // Add workdir option if specified
          if (options?.workdir) {
            args.push("-w", options.workdir)
          }

          // Add environment variables if specified
          if (options?.env) {
            for (const envVar of options.env) {
              args.push("-e", envVar)
            }
          }

          // Add container name and command
          args.push(containerName, "sh", "-c", command)

          // Start the command process to get access to streams
          const process = yield* Command.make("docker", ...args).pipe(
            Command.start,
            Effect.mapError(
              (e) =>
                new DockerError({
                  command: "exec",
                  cause: e
                })
            ),
            Effect.provide(BunContext.layer)
          )

          // Return stdout and stderr as Effect Streams of strings
          // Convert Uint8Array streams to string streams
          return {
            stdout: process.stdout.pipe(
              Stream.map((chunk: Uint8Array) => new TextDecoder().decode(chunk)),
              Stream.mapError(
                (e) =>
                  new DockerError({
                    command: "exec",
                    cause: e
                  })
              )
            ),
            stderr: process.stderr.pipe(
              Stream.map((chunk: Uint8Array) => new TextDecoder().decode(chunk)),
              Stream.mapError(
                (e) =>
                  new DockerError({
                    command: "exec",
                    cause: e
                  })
              )
            )
          }
        })
      ),
    readFile: (containerName: string, path: string) =>
      Effect.gen(function* () {
        // Build docker exec command to read file using cat
        const args = ["exec", containerName, "cat", path]

        // Execute docker exec and return the file content as string
        const content = yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "readFile",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        return content
      }),

    writeFile: (containerName: string, path: string, content: string) =>
      Effect.gen(function* () {
        // Create a stream from the file content string
        // TextEncoder converts string to Uint8Array for stdin piping
        const contentStream = Stream.make(new TextEncoder().encode(content))

        // Build docker exec command for writing via stdin
        // Using -i flag to enable stdin and tee to avoid escaping issues
        const args = ["exec", "-i", containerName, "tee", path]

        // Execute command with stdin piping
        yield* Command.make("docker", ...args).pipe(
          Command.stdin(contentStream),
          Command.string,
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "writeFile",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )
      }),

    copyToContainer: () => Effect.dieMessage("Not implemented yet"),

    listByPrefix: (containerName: string, prefix: string) =>
      Effect.gen(function* () {
        // Build command to list files by prefix using find
        // Using find with -name pattern to match prefix
        const command = `find /workspace -maxdepth 1 -name '${prefix}*' -type f -printf '%f\\n' 2>/dev/null || true`

        // Execute the command and get output
        const output = yield* Command.make("docker", "exec", containerName, "sh", "-c", command).pipe(
          Command.string,
          Effect.map((output) => output.trim()),
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "listByPrefix",
                cause: e
              })
          ),
          Effect.provide(BunContext.layer)
        )

        // Parse output into array of file names
        const files = output.length > 0
          ? output.split('\n').filter((line) => line.trim().length > 0)
          : []

        return files as ReadonlyArray<string>
      })
} satisfies IDockerService

export const DockerLive = Layer.effect(
  DockerService,
  Effect.sync(() => implementation)
)
