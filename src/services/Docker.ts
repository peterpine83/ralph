// src/services/Docker.ts
import { Context, Effect, Stream } from "effect"
import type { DockerError, ContainerNotFoundError } from "../errors"

export interface ContainerConfig {
  name: string
  image: string
  capabilities: string[]
  environment: Record<string, string>
  volumes: Array<{
    host: string
    container: string
    readonly: boolean
  }>
}

export interface ExecOptions {
  user?: string
  workdir?: string
  env?: Record<string, string>
}

export interface DockerService {
  // Lifecycle
  readonly create: (config: ContainerConfig) => Effect.Effect<void, DockerError>
  readonly start: (container: string) => Effect.Effect<void, DockerError>
  readonly remove: (container: string) => Effect.Effect<void, DockerError>
  readonly inspect: (container: string) => Effect.Effect<boolean, ContainerNotFoundError>

  // Execution
  readonly exec: (
    container: string,
    cmd: string[],
    options?: ExecOptions
  ) => Effect.Effect<string, DockerError>

  readonly execStream: (
    container: string,
    cmd: string[],
    options?: ExecOptions
  ) => Effect.Effect<{
    stdout: Stream.Stream<Uint8Array, DockerError>
    stderr: Stream.Stream<Uint8Array, DockerError>
    exitCode: Effect.Effect<number, DockerError>
  }, DockerError>

  // Queries
  readonly listByPrefix: (prefix: string) => Effect.Effect<string[], DockerError>

  // File operations
  readonly copyToContainer: (
    container: string,
    tarStream: ReadableStream<Uint8Array>,
    destPath: string
  ) => Effect.Effect<void, DockerError>

  readonly readFile: (
    container: string,
    path: string
  ) => Effect.Effect<string, DockerError>

  readonly writeFile: (
    container: string,
    path: string,
    content: string
  ) => Effect.Effect<void, DockerError>
}

export class DockerService extends Context.Tag("ralph/DockerService")<
  DockerService,
  DockerService
>() {}
