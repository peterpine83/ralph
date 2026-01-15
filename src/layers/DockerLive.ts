// DockerLive layer implementation
import { Layer, Effect } from "effect"
import { Command } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import { DockerService, type IDockerService } from "../services/Docker"
import { DockerError } from "../errors"
import type { ContainerConfig } from "../services/Docker"

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

    start: () => Effect.dieMessage("Not implemented yet"),
    remove: () => Effect.dieMessage("Not implemented yet"),
    inspect: () => Effect.dieMessage("Not implemented yet"),
    exec: () => Effect.dieMessage("Not implemented yet"),
    execStream: () => Effect.dieMessage("Not implemented yet"),
    readFile: () => Effect.dieMessage("Not implemented yet"),
    writeFile: () => Effect.dieMessage("Not implemented yet"),
    copyToContainer: () => Effect.dieMessage("Not implemented yet"),
    listByPrefix: () => Effect.dieMessage("Not implemented yet")
} satisfies IDockerService

export const DockerLive = Layer.effect(
  DockerService,
  Effect.sync(() => implementation)
)
