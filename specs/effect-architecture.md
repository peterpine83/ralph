# Effect Architecture Specification

**Purpose**: Define the Effect.ts integration strategy for Ralph, transforming the codebase to use type-safe errors, dependency injection, and resource management.

## Overview

Ralph adopts Effect.ts as its foundational runtime, replacing:
- Manual try-catch with typed error channels
- Global environment variables with Config service
- Bun.$ shell commands with @effect/platform Command
- Mutable state with Effect Ref
- Raw streams with Effect Stream

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              src/main.ts                                     │
│                           (Entry Point)                                      │
│                                                                              │
│  BunRuntime.runMain(                                                        │
│    mainLoop.pipe(                                                           │
│      Effect.provide(MainLive)   // All layers composed here                 │
│    )                                                                         │
│  )                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ provides
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MainLive Layer                                  │
│                                                                              │
│  Layer.mergeAll(                                                            │
│    ConfigLive,        // Environment variables, validation                  │
│    DockerLive,        // Container management                               │
│    ClaudeLive,        // Claude CLI invocation                              │
│    DashboardLive,     // SSE server + Ref state                             │
│    GitLive            // Git operations                                     │
│  )                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │ ConfigService│ │DockerService │ │ClaudeService │
           │              │ │              │ │              │
           │ oauthToken   │ │ create()     │ │ run()        │
           │ githubToken  │ │ exec()       │ │ parseEvents()│
           │ maxIterations│ │ remove()     │ │              │
           │ dashboardPort│ │ inspect()    │ │              │
           └──────────────┘ └──────────────┘ └──────────────┘
```

## Directory Structure

```
src/
├── main.ts                 # Entry point, BunRuntime.runMain()
├── program.ts              # Main orchestration Effect program
├── services/               # Service interfaces (Context.Tag)
│   ├── Config.ts           # Configuration service
│   ├── Docker.ts           # Docker operations
│   ├── Claude.ts           # Claude CLI
│   ├── Git.ts              # Git operations
│   └── Dashboard.ts        # Dashboard state
├── layers/                 # Service implementations (Layer)
│   ├── ConfigLive.ts       # Config from env + CLI args
│   ├── DockerLive.ts       # @effect/platform Command
│   ├── ClaudeLive.ts       # Claude execution with streaming
│   ├── GitLive.ts          # Git via Command
│   └── DashboardLive.ts    # Bun.serve + Ref state
├── errors/                 # Error types (Data.TaggedError)
│   └── index.ts            # All error definitions
├── streams/                # Stream utilities
│   └── ndjson.ts           # NDJSON parsing stream
└── types.ts                # Shared types (Feature, ClaudeEvent)
```

## Core Patterns

### 1. Service Definition Pattern

Services are defined as interfaces with `Context.Tag`:

```typescript
// services/Docker.ts
import { Context, Effect } from "effect"
import type { DockerError, ContainerNotFoundError } from "../errors"

interface ContainerConfig {
  name: string
  image: string
  capabilities: string[]
  environment: Record<string, string>
  volumes: Array<{ host: string; container: string; readonly: boolean }>
}

interface DockerService {
  readonly create: (config: ContainerConfig) => Effect.Effect<string, DockerError>
  readonly start: (container: string) => Effect.Effect<void, DockerError>
  readonly exec: (container: string, cmd: string[]) => Effect.Effect<string, DockerError>
  readonly inspect: (container: string) => Effect.Effect<boolean, ContainerNotFoundError>
  readonly remove: (container: string) => Effect.Effect<void, DockerError>
  readonly listByPrefix: (prefix: string) => Effect.Effect<string[], DockerError>
}

class DockerService extends Context.Tag("ralph/DockerService")<
  DockerService,
  DockerService
>() {}
```

### 2. Layer Implementation Pattern

Layers provide service implementations:

```typescript
// layers/DockerLive.ts
import { Layer, Effect } from "effect"
import { Command } from "@effect/platform"
import { DockerService } from "../services/Docker"
import { DockerError } from "../errors"

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
          config.image,
          "tail", "-f", "/dev/null"
        ]
        const result = yield* Command.make("docker", ...args).pipe(
          Command.string,
          Effect.mapError((e) => new DockerError({ command: "create", cause: e }))
        )
        return result.trim()
      }),

    exec: (container, cmd) =>
      Command.make("docker", "exec", container, ...cmd).pipe(
        Command.string,
        Effect.mapError((e) => new DockerError({ command: "exec", cause: e }))
      ),

    // ... other methods
  })
)
```

### 3. Error Type Pattern

Errors use `Data.TaggedError` for type-safe handling:

```typescript
// errors/index.ts
import { Data } from "effect"

class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  cause: unknown
}> {}

class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string
  durationMs: number
}> {}

class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  iterations: number
  message: string
}> {}
```

### 4. Program Composition Pattern

The main program composes services:

```typescript
// program.ts
import { Effect, Schedule } from "effect"
import { DockerService } from "./services/Docker"
import { ClaudeService } from "./services/Claude"
import { ConfigService } from "./services/Config"

const mainLoop = Effect.gen(function* () {
  const config = yield* ConfigService
  const docker = yield* DockerService
  const claude = yield* ClaudeService

  // Create session
  const containerName = yield* docker.create({
    name: `ralph-${Date.now()}`,
    image: "ralph-base:latest",
    capabilities: ["NET_ADMIN"],
    environment: {
      CLAUDE_CODE_OAUTH_TOKEN: config.oauthToken,
      GITHUB_TOKEN: config.githubToken
    },
    volumes: [{ host: "~/.ssh", container: "/root/.ssh", readonly: true }]
  })

  // Main iteration loop
  yield* Effect.iterate(
    { iteration: 0, noChangeCount: 0 },
    {
      while: (state) => state.iteration < config.maxIterations,
      body: (state) => runIteration(containerName, state)
    }
  )
})
```

## Migration Strategy

### Phase 1: Foundation
1. Install Effect dependencies
2. Create error types in `src/errors/`
3. Create service interfaces in `src/services/`

### Phase 2: Services
4. Implement ConfigLive (environment + CLI args)
5. Implement DockerLive (@effect/platform Command)
6. Implement GitLive (git operations)

### Phase 3: Core Logic
7. Implement ClaudeLive with Stream for NDJSON
8. Implement DashboardLive with Ref state
9. Convert main orchestration to Effect program

### Phase 4: Testing
10. Create test layers for mocking
11. Convert existing tests to Effect testing
12. Add integration tests with TestContext

## Dependencies

```json
{
  "dependencies": {
    "effect": "^3.12.0",
    "@effect/platform": "^0.72.0",
    "@effect/platform-bun": "^0.52.0",
    "@effect/schema": "^0.76.0"
  }
}
```

## Runtime Configuration

```typescript
// main.ts
import { BunRuntime } from "@effect/platform-bun"
import { mainLoop } from "./program"
import { MainLive } from "./layers"

BunRuntime.runMain(
  mainLoop.pipe(
    Effect.provide(MainLive),
    Effect.catchTags({
      DockerError: (e) => Console.error(`Docker failed: ${e.command}`),
      TimeoutError: (e) => Console.error(`Timeout: ${e.operation}`),
      CircuitBreakerError: (e) => Console.error(`Circuit breaker: ${e.message}`)
    })
  )
)
```

## Integration with Existing Code

### Preserved Patterns
- Docker container lifecycle (create → start → exec → remove)
- Feature processing pipeline (read → filter → implement → verify)
- Circuit breaker logic (3 no-change iterations)
- Dashboard SSE broadcasting

### Changed Patterns
| Before | After |
|--------|-------|
| `process.env.CLAUDE_CODE_OAUTH_TOKEN` | `yield* ConfigService` |
| `Bun.$\`docker exec...\`` | `yield* DockerService.exec()` |
| `try { ... } catch (e) { ... }` | `Effect.catchTag("DockerError", ...)` |
| Mutable `state` object | `Ref<DashboardState>` |
| Manual stream reading | `Stream.fromReadableStream()` |

## Related Specs

- [effect-services.md](./effect-services.md) - Service interface definitions
- [effect-errors.md](./effect-errors.md) - Error type catalog
- [effect-streams.md](./effect-streams.md) - Stream patterns for NDJSON
