// Docker service for container lifecycle and operations
import { Context } from "effect"
import type { Effect, Stream } from "effect"

// Error types for Docker operations
export interface DockerError {
  readonly _tag: "DockerError"
  readonly message: string
  readonly cause?: unknown
}

// Container configuration for creating new containers
export interface ContainerConfig {
  readonly name: string
  readonly image: string
  readonly volumes?: ReadonlyArray<string>
  readonly env?: ReadonlyArray<string>
  readonly capAdd?: ReadonlyArray<string>
  readonly workdir?: string
  readonly user?: string
}

// Container inspection result
export interface ContainerInfo {
  readonly id: string
  readonly name: string
  readonly running: boolean
  readonly status: string
}

// Execution options for container commands
export interface ExecOptions {
  readonly user?: string
  readonly workdir?: string
  readonly env?: ReadonlyArray<string>
}

// Stream output from container execution
export interface ExecStreamOutput {
  readonly stdout: Stream.Stream<string, DockerError>
  readonly stderr: Stream.Stream<string, DockerError>
}

// DockerService interface for container lifecycle management
export interface IDockerService {
  /**
   * Create a new container from an image
   */
  readonly create: (
    config: ContainerConfig
  ) => Effect.Effect<string, DockerError>

  /**
   * Start an existing container
   */
  readonly start: (containerName: string) => Effect.Effect<void, DockerError>

  /**
   * Remove a container (with optional force flag)
   */
  readonly remove: (
    containerName: string,
    force?: boolean
  ) => Effect.Effect<void, DockerError>

  /**
   * Inspect a container and return its information
   */
  readonly inspect: (
    containerName: string
  ) => Effect.Effect<ContainerInfo, DockerError>

  /**
   * Execute a command in a running container
   */
  readonly exec: (
    containerName: string,
    command: string,
    options?: ExecOptions
  ) => Effect.Effect<string, DockerError>

  /**
   * Execute a command with streaming stdout/stderr
   */
  readonly execStream: (
    containerName: string,
    command: string,
    options?: ExecOptions
  ) => Effect.Effect<ExecStreamOutput, DockerError>

  /**
   * Read a file from a container
   */
  readonly readFile: (
    containerName: string,
    path: string
  ) => Effect.Effect<string, DockerError>

  /**
   * Write a file to a container
   */
  readonly writeFile: (
    containerName: string,
    path: string,
    content: string
  ) => Effect.Effect<void, DockerError>

  /**
   * Copy files to a container
   */
  readonly copyToContainer: (
    containerName: string,
    sourcePath: string,
    destPath: string
  ) => Effect.Effect<void, DockerError>

  /**
   * List files in a container by prefix
   */
  readonly listByPrefix: (
    containerName: string,
    prefix: string
  ) => Effect.Effect<ReadonlyArray<string>, DockerError>
}

export class DockerService extends Context.Tag("ralph/DockerService")<
  DockerService,
  IDockerService
>() {}
