# Effect Services Specification

**Purpose**: Define service interfaces and layer implementations for Ralph's Effect architecture.

## Service Overview

| Service | Purpose | Dependencies |
|---------|---------|--------------|
| ConfigService | Environment + CLI configuration | None |
| DockerService | Container lifecycle management | ConfigService |
| ClaudeService | Claude CLI execution with streaming | DockerService, ConfigService |
| GitService | Git operations (push, log, branch) | DockerService |
| DashboardService | SSE server and state management | ConfigService |

## ConfigService

**File**: `src/services/Config.ts`
**Purpose**: Type-safe configuration from environment variables and CLI arguments

### Interface

```typescript
import { Context, Effect } from "effect"

interface ConfigService {
  // Required
  readonly oauthToken: string
  readonly gitRoot: string

  // With defaults
  readonly githubToken: string              // default: ""
  readonly featuresPath: string             // default: "features.json"
  readonly branch: string | undefined       // default: auto-generated
  readonly maxIterations: number            // default: 5
  readonly dashboardPort: number            // default: 3847
  readonly timeoutMs: number                // default: 300000 (5 min)

  // Flags
  readonly once: boolean                    // default: false
  readonly stepMode: boolean                // default: false
  readonly dashboardEnabled: boolean        // default: false
}

class ConfigService extends Context.Tag("ralph/ConfigService")<
  ConfigService,
  ConfigService
>() {}
```

### Layer Implementation

**File**: `src/layers/ConfigLive.ts`

```typescript
import { Layer, Effect, Config } from "effect"
import { ConfigService } from "../services/Config"
import { ConfigError } from "../errors"

// CLI args parsed separately
interface CliArgs {
  featuresPath?: string
  branch?: string
  once?: boolean
  maxIterations?: number
  dashboard?: boolean
  dashboardPort?: number
  step?: boolean
}

const makeConfigLive = (cliArgs: CliArgs) =>
  Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      // Required - fail if missing
      const oauthToken = yield* Config.string("CLAUDE_CODE_OAUTH_TOKEN").pipe(
        Effect.mapError(() => new ConfigError({
          variable: "CLAUDE_CODE_OAUTH_TOKEN",
          message: "Required environment variable not set"
        }))
      )

      // Optional with fallback
      const githubToken = yield* Config.string("GITHUB_TOKEN").pipe(
        Effect.orElse(() => Effect.succeed(""))
      )

      // Git root detection
      const gitRoot = yield* detectGitRoot()

      return ConfigService.of({
        oauthToken,
        githubToken,
        gitRoot,
        featuresPath: cliArgs.featuresPath ?? "features.json",
        branch: cliArgs.branch,
        maxIterations: cliArgs.maxIterations ?? 5,
        dashboardPort: cliArgs.dashboardPort ?? 3847,
        timeoutMs: 5 * 60 * 1000,
        once: cliArgs.once ?? false,
        stepMode: cliArgs.step ?? false,
        dashboardEnabled: cliArgs.dashboard ?? false
      })
    })
  )
```

### Usage

```typescript
const program = Effect.gen(function* () {
  const config = yield* ConfigService
  console.log(`Max iterations: ${config.maxIterations}`)
  console.log(`Features: ${config.featuresPath}`)
})
```

---

## DockerService

**File**: `src/services/Docker.ts`
**Purpose**: Docker container lifecycle management via @effect/platform Command

### Interface

```typescript
import { Context, Effect, Stream } from "effect"
import type { DockerError, ContainerNotFoundError } from "../errors"

interface ContainerConfig {
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

interface ExecOptions {
  user?: string
  workdir?: string
  env?: Record<string, string>
}

interface DockerService {
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

class DockerService extends Context.Tag("ralph/DockerService")<
  DockerService,
  DockerService
>() {}
```

### Layer Implementation

**File**: `src/layers/DockerLive.ts`

```typescript
import { Layer, Effect, Stream } from "effect"
import { Command } from "@effect/platform"
import { DockerService } from "../services/Docker"
import { DockerError, ContainerNotFoundError } from "../errors"

const DockerLive = Layer.succeed(
  DockerService,
  DockerService.of({
    create: (config) =>
      Effect.gen(function* () {
        const args = [
          "create",
          "--name", config.name,
          ...config.capabilities.flatMap(c => ["--cap-add", c]),
          ...Object.entries(config.environment).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
          ...config.volumes.flatMap(v =>
            ["-v", `${v.host}:${v.container}${v.readonly ? ":ro" : ""}`]
          ),
          config.image,
          "tail", "-f", "/dev/null"
        ]

        yield* Command.make("docker", ...args).pipe(
          Command.exitCode,
          Effect.flatMap((code) =>
            code === 0
              ? Effect.void
              : Effect.fail(new DockerError({ command: "create", exitCode: code }))
          )
        )
      }),

    start: (container) =>
      Command.make("docker", "start", container).pipe(
        Command.exitCode,
        Effect.flatMap((code) =>
          code === 0
            ? Effect.void
            : Effect.fail(new DockerError({ command: "start", exitCode: code }))
        )
      ),

    exec: (container, cmd, options = {}) =>
      Effect.gen(function* () {
        const args = ["exec"]
        if (options.user) args.push("-u", options.user)
        if (options.workdir) args.push("-w", options.workdir)
        args.push(container, ...cmd)

        return yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.mapError((e) => new DockerError({ command: "exec", cause: e }))
        )
      }),

    execStream: (container, cmd, options = {}) =>
      Effect.gen(function* () {
        const args = ["exec"]
        if (options.user) args.push("-u", options.user)
        args.push(container, ...cmd)

        const process = yield* Command.make("docker", ...args).pipe(
          Command.start,
          Effect.mapError((e) => new DockerError({ command: "exec", cause: e }))
        )

        return {
          stdout: process.stdout,
          stderr: process.stderr,
          exitCode: process.exitCode.pipe(
            Effect.mapError((e) => new DockerError({ command: "exec", cause: e }))
          )
        }
      }),

    inspect: (container) =>
      Command.make("docker", "inspect", "-f", "{{.State.Running}}", container).pipe(
        Command.string,
        Effect.map((output) => output.trim() === "true"),
        Effect.mapError(() => new ContainerNotFoundError({ container }))
      ),

    remove: (container) =>
      Command.make("docker", "rm", "-f", container).pipe(
        Command.exitCode,
        Effect.map(() => undefined),
        Effect.mapError((e) => new DockerError({ command: "remove", cause: e }))
      ),

    listByPrefix: (prefix) =>
      Command.make("docker", "ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}").pipe(
        Command.string,
        Effect.map((output) =>
          output.trim().split("\n").filter((name) => name.length > 0)
        ),
        Effect.mapError((e) => new DockerError({ command: "ps", cause: e }))
      ),

    copyToContainer: (container, tarStream, destPath) =>
      Effect.gen(function* () {
        // Implementation using docker exec with stdin
        const process = yield* Command.make("docker", "exec", "-i", container, "tar", "-xf", "-", "-C", destPath).pipe(
          Command.start,
          Effect.mapError((e) => new DockerError({ command: "copy", cause: e }))
        )

        // Pipe tarStream to process stdin
        yield* Stream.fromReadableStream(
          () => tarStream,
          (e) => new DockerError({ command: "copy", cause: e })
        ).pipe(
          Stream.run(process.stdin)
        )

        yield* process.exitCode
      }),

    readFile: (container, path) =>
      Command.make("docker", "exec", container, "cat", path).pipe(
        Command.string,
        Effect.mapError((e) => new DockerError({ command: "cat", cause: e }))
      ),

    writeFile: (container, path, content) =>
      Effect.gen(function* () {
        // Write via stdin to avoid shell escaping issues
        const process = yield* Command.make("docker", "exec", "-i", container, "tee", path).pipe(
          Command.start,
          Effect.mapError((e) => new DockerError({ command: "tee", cause: e }))
        )

        yield* Stream.make(new TextEncoder().encode(content)).pipe(
          Stream.run(process.stdin)
        )

        yield* process.exitCode
      })
  })
)
```

---

## ClaudeService

**File**: `src/services/Claude.ts`
**Purpose**: Claude CLI execution with NDJSON stream parsing

### Interface

```typescript
import { Context, Effect, Stream } from "effect"
import type { ClaudeEvent } from "../types"
import type { ClaudeError, TimeoutError } from "../errors"

interface ClaudeRunOptions {
  timeout?: number       // ms, default from config
  workdir?: string       // default: /workspace
}

interface ClaudeService {
  readonly run: (
    container: string,
    prompt: string,
    options?: ClaudeRunOptions
  ) => Effect.Effect<void, ClaudeError | TimeoutError>

  readonly runWithEvents: (
    container: string,
    prompt: string,
    options?: ClaudeRunOptions
  ) => Stream.Stream<ClaudeEvent, ClaudeError | TimeoutError>
}

class ClaudeService extends Context.Tag("ralph/ClaudeService")<
  ClaudeService,
  ClaudeService
>() {}
```

### Layer Implementation

**File**: `src/layers/ClaudeLive.ts`

```typescript
import { Layer, Effect, Stream, Schedule } from "effect"
import { ClaudeService } from "../services/Claude"
import { DockerService } from "../services/Docker"
import { ConfigService } from "../services/Config"
import { ClaudeError, TimeoutError } from "../errors"
import { parseNDJSON } from "../streams/ndjson"
import type { ClaudeEvent } from "../types"

const ClaudeLive = Layer.effect(
  ClaudeService,
  Effect.gen(function* () {
    const docker = yield* DockerService
    const config = yield* ConfigService

    return ClaudeService.of({
      run: (container, prompt, options = {}) =>
        Effect.gen(function* () {
          const timeout = options.timeout ?? config.timeoutMs

          yield* docker.exec(
            container,
            [
              "claude", "-p",
              "--dangerously-skip-permissions",
              "--verbose",
              "--output-format", "stream-json",
              prompt
            ],
            { user: "node", workdir: options.workdir ?? "/workspace" }
          ).pipe(
            Effect.timeout(timeout),
            Effect.mapError((e) =>
              e._tag === "TimeoutException"
                ? new TimeoutError({ operation: "claude", durationMs: timeout })
                : new ClaudeError({ cause: e })
            )
          )
        }),

      runWithEvents: (container, prompt, options = {}) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const timeout = options.timeout ?? config.timeoutMs

            const { stdout, exitCode } = yield* docker.execStream(
              container,
              [
                "claude", "-p",
                "--dangerously-skip-permissions",
                "--verbose",
                "--output-format", "stream-json",
                prompt
              ],
              { user: "node", workdir: options.workdir ?? "/workspace" }
            )

            // Parse NDJSON from stdout
            return parseNDJSON<ClaudeEvent>(stdout).pipe(
              Stream.timeout(timeout),
              Stream.mapError((e) =>
                e._tag === "TimeoutException"
                  ? new TimeoutError({ operation: "claude", durationMs: timeout })
                  : new ClaudeError({ cause: e })
              )
            )
          })
        )
    })
  })
)
```

---

## GitService

**File**: `src/services/Git.ts`
**Purpose**: Git operations executed inside the container

### Interface

```typescript
import { Context, Effect } from "effect"
import type { GitError } from "../errors"

interface GitService {
  readonly checkout: (container: string, branch: string) => Effect.Effect<void, GitError>
  readonly fetch: (container: string) => Effect.Effect<void, GitError>
  readonly push: (container: string) => Effect.Effect<void, GitError>
  readonly hasUnpushedCommits: (container: string, branch: string) => Effect.Effect<boolean, GitError>
  readonly createBranch: (container: string, name: string) => Effect.Effect<void, GitError>
  readonly configureUser: (container: string) => Effect.Effect<void, GitError>
}

class GitService extends Context.Tag("ralph/GitService")<
  GitService,
  GitService
>() {}
```

### Layer Implementation

**File**: `src/layers/GitLive.ts`

```typescript
const GitLive = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const docker = yield* DockerService

    return GitService.of({
      checkout: (container, branch) =>
        docker.exec(container, ["git", "checkout", branch]).pipe(
          Effect.mapError((e) => new GitError({ operation: "checkout", cause: e })),
          Effect.asVoid
        ),

      fetch: (container) =>
        docker.exec(container, ["git", "fetch", "origin"]).pipe(
          Effect.mapError((e) => new GitError({ operation: "fetch", cause: e })),
          Effect.asVoid
        ),

      push: (container) =>
        docker.exec(container, ["git", "push", "-u", "origin", "HEAD"]).pipe(
          Effect.mapError((e) => new GitError({ operation: "push", cause: e })),
          Effect.asVoid
        ),

      hasUnpushedCommits: (container, branch) =>
        docker.exec(container, ["git", "log", `origin/${branch}..HEAD`, "--oneline"]).pipe(
          Effect.map((output) => output.trim().length > 0),
          Effect.mapError((e) => new GitError({ operation: "log", cause: e }))
        ),

      createBranch: (container, name) =>
        docker.exec(container, ["git", "checkout", "-b", name]).pipe(
          Effect.mapError((e) => new GitError({ operation: "createBranch", cause: e })),
          Effect.asVoid
        ),

      configureUser: (container) =>
        docker.exec(container, [
          "git", "config", "--system", "credential.helper", "!gh auth git-credential"
        ]).pipe(
          Effect.mapError((e) => new GitError({ operation: "config", cause: e })),
          Effect.asVoid
        )
    })
  })
)
```

---

## DashboardService

**File**: `src/services/Dashboard.ts`
**Purpose**: SSE server and state management with Effect Ref

### Interface

```typescript
import { Context, Effect, Ref } from "effect"
import type { DashboardState, DashboardEvent } from "../types"

interface DashboardService {
  // State access
  readonly getState: Effect.Effect<DashboardState>
  readonly updateState: (fn: (state: DashboardState) => DashboardState) => Effect.Effect<void>

  // Convenience setters
  readonly setPaused: (paused: boolean) => Effect.Effect<void>
  readonly setRunning: (running: boolean) => Effect.Effect<void>
  readonly setStopping: (stopping: boolean) => Effect.Effect<void>
  readonly setIteration: (current: number, max: number) => Effect.Effect<void>
  readonly setFeatures: (features: Feature[]) => Effect.Effect<void>

  // Broadcasting
  readonly broadcast: (event: DashboardEvent) => Effect.Effect<void>
  readonly sendOutput: (text: string) => Effect.Effect<void>

  // Server lifecycle
  readonly start: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
}

class DashboardService extends Context.Tag("ralph/DashboardService")<
  DashboardService,
  DashboardService
>() {}
```

### Layer Implementation

**File**: `src/layers/DashboardLive.ts`

```typescript
const DashboardLive = Layer.scoped(
  DashboardService,
  Effect.gen(function* () {
    const config = yield* ConfigService

    // Mutable state as Ref
    const stateRef = yield* Ref.make<DashboardState>({
      paused: false,
      running: false,
      stepMode: config.stepMode,
      stopping: false,
      claudeRunning: false,
      containerName: "",
      branch: "",
      iteration: 0,
      maxIterations: config.maxIterations,
      features: [],
      promptTemplate: ""
    })

    // SSE clients as mutable Set (managed outside Effect)
    const clients = new Set<WritableStreamDefaultWriter>()

    // Create Bun server
    const server = Bun.serve({
      port: config.dashboardPort,
      fetch: (req) => handleRequest(req, stateRef, clients)
    })

    // Cleanup on scope close
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        server.stop()
        clients.clear()
      })
    )

    return DashboardService.of({
      getState: Ref.get(stateRef),

      updateState: (fn) =>
        Ref.update(stateRef, fn).pipe(
          Effect.tap(() =>
            Effect.sync(() => broadcastState(clients, stateRef))
          )
        ),

      setPaused: (paused) =>
        Ref.update(stateRef, (s) => ({ ...s, paused })),

      setRunning: (running) =>
        Ref.update(stateRef, (s) => ({ ...s, running })),

      setStopping: (stopping) =>
        Ref.update(stateRef, (s) => ({ ...s, stopping })),

      setIteration: (current, max) =>
        Ref.update(stateRef, (s) => ({ ...s, iteration: current, maxIterations: max })),

      setFeatures: (features) =>
        Ref.update(stateRef, (s) => ({ ...s, features })),

      broadcast: (event) =>
        Effect.sync(() => {
          const json = JSON.stringify(event)
          for (const client of clients) {
            try {
              client.write(`data: ${json}\n\n`)
            } catch {
              clients.delete(client)
            }
          }
        }),

      sendOutput: (text) =>
        Effect.sync(() => {
          const event: OutputEvent = {
            type: "output",
            data: { text, timestamp: Date.now() }
          }
          const json = JSON.stringify(event)
          for (const client of clients) {
            try {
              client.write(`data: ${json}\n\n`)
            } catch {
              clients.delete(client)
            }
          }
        }),

      start: Effect.void,  // Server started in layer construction
      stop: Effect.sync(() => server.stop())
    })
  })
)
```

---

## Layer Composition

**File**: `src/layers/index.ts`

```typescript
import { Layer } from "effect"
import { ConfigLive, makeConfigLive } from "./ConfigLive"
import { DockerLive } from "./DockerLive"
import { ClaudeLive } from "./ClaudeLive"
import { GitLive } from "./GitLive"
import { DashboardLive } from "./DashboardLive"

// Full production layer
export const MainLive = (cliArgs: CliArgs) =>
  Layer.mergeAll(
    makeConfigLive(cliArgs),
    DockerLive,
    GitLive
  ).pipe(
    Layer.provideMerge(ClaudeLive),
    Layer.provideMerge(DashboardLive)
  )

// Test layer with mocks
export const TestLive = Layer.mergeAll(
  ConfigTest,
  DockerTest,
  ClaudeTest,
  GitTest,
  DashboardTest
)
```

---

## Testing Services

### Mock Layer Example

```typescript
// src/layers/DockerTest.ts
const DockerTest = Layer.succeed(
  DockerService,
  DockerService.of({
    create: () => Effect.succeed(undefined),
    start: () => Effect.succeed(undefined),
    exec: (_, cmd) => {
      // Return mock responses based on command
      if (cmd.includes("cat") && cmd.includes("features.json")) {
        return Effect.succeed('{"features":[]}')
      }
      return Effect.succeed("")
    },
    inspect: () => Effect.succeed(true),
    remove: () => Effect.succeed(undefined),
    listByPrefix: () => Effect.succeed([]),
    copyToContainer: () => Effect.succeed(undefined),
    readFile: () => Effect.succeed(""),
    writeFile: () => Effect.succeed(undefined)
  })
)
```

### Test Example

```typescript
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mainLoop } from "../program"
import { TestLive } from "../layers"

describe("mainLoop", () => {
  test("completes when all features pass", async () => {
    const result = await mainLoop.pipe(
      Effect.provide(TestLive),
      Effect.runPromise
    )

    expect(result).toBeDefined()
  })
})
```
