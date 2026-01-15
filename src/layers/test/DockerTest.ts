import { Layer, Effect, Stream } from "effect"
import { DockerService, type IDockerService } from "../../services/Docker.js"
import type { ContainerConfig, ContainerInfo, ExecStreamOutput } from "../../services/Docker.js"

/**
 * DockerTest provides mock Docker operations for testing.
 * Simulates container operations without actually running Docker commands.
 */
const mockImplementation: IDockerService = {
  create: (config: ContainerConfig) =>
    Effect.succeed(`mock-container-id-${config.name}`),

  start: (_containerName: string) => Effect.succeed(undefined),

  remove: (_containerName: string, _force?: boolean) => Effect.succeed(undefined),

  inspect: (containerName: string) =>
    Effect.succeed({
      id: `mock-id-${containerName}`,
      name: containerName,
      running: true,
      status: "running",
    } satisfies ContainerInfo),

  exec: (_containerName: string, command: string, _options?) =>
    Effect.gen(function* () {
      // Return predictable responses based on command patterns
      if (command.includes("typecheck")) {
        return "TypeScript check passed"
      }
      if (command.includes("test")) {
        return "All tests passed"
      }
      if (command.includes("git status")) {
        return "On branch test\nnothing to commit, working tree clean"
      }
      if (command.includes("cat")) {
        // Mock file reading
        return '{"mock": "content"}'
      }
      // Default response
      return "mock exec output"
    }),

  execStream: (_containerName: string, command: string, _options?) =>
    Effect.succeed({
      stdout: Stream.make("mock stdout: " + command),
      stderr: Stream.empty,
    } satisfies ExecStreamOutput),

  readFile: (_containerName: string, path: string) =>
    Effect.succeed(`mock content of ${path}`),

  writeFile: (_containerName: string, _path: string, _content: string) =>
    Effect.succeed(undefined),

  copyToContainer: (_containerName: string, _sourcePath: string, _destPath: string) =>
    Effect.succeed(undefined),

  listByPrefix: (_containerName: string, prefix: string) =>
    Effect.succeed([`${prefix}file1.txt`, `${prefix}file2.txt`]),
}

export const DockerTest = Layer.succeed(DockerService, mockImplementation)
