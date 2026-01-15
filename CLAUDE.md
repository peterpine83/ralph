# CLAUDE.md

Ralph is an autonomous coding agent orchestrator that runs Claude Code inside isolated Docker containers with network restrictions. It processes features from `.ralph/features.json`, implementing them until all pass their verification commands.

## Commands

```bash
bun test                    # run tests
bun run typecheck           # run TypeScript type checking
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/
```

## Project Structure

```
your-project/
└── .ralph/
    └── features.json    # defines features to implement
```

## Effect Architecture

Ralph uses [Effect.ts](https://effect.website) for type-safe, composable, and testable asynchronous programming. The architecture is built on three key concepts: **Services**, **Layers**, and **Errors**.

### Services

Services are typed interfaces defined using `Context.Tag` that provide dependency-injected capabilities:

- **ConfigService** (`src/services/Config.ts`) - Environment configuration and CLI arguments
- **DockerService** (`src/services/Docker.ts`) - Container lifecycle and command execution
- **ClaudeService** (`src/services/Claude.ts`) - Claude Code CLI invocation with streaming
- **GitService** (`src/services/Git.ts`) - Git operations within containers
- **DashboardService** (`src/services/Dashboard.ts`) - State management and SSE broadcasting

All services are re-exported from `src/services/index.ts`.

### Layers

Layers are Effect's dependency injection containers that provide concrete implementations:

#### Live Layers (Production)
- **ConfigLive** (`src/layers/ConfigLive.ts`) - Detects git root and loads environment variables
- **DockerLive** (`src/layers/DockerLive.ts`) - Uses `@effect/platform` Command for Docker operations
- **GitLive** (`src/layers/GitLive.ts`) - Delegates git commands to DockerService
- **ClaudeLive** (`src/layers/ClaudeLive.ts`) - Implements Claude streaming with NDJSON parsing
- **DashboardLive** (`src/layers/DashboardLive.ts`) - Scoped layer with SSE server and Ref state

#### Layer Composition
```typescript
// src/layers/index.ts
export const MainLive = (cliArgs, containerName, initialState) =>
  Layer.mergeAll(
    makeConfigLive(cliArgs),
    DockerLive,
    makeGitLive(containerName)
  ).pipe(
    Layer.provideMerge(makeClaudeLive()),
    Layer.provideMerge(makeDashboardLive(initialState))
  )
```

Uses `Layer.mergeAll` for independent layers, `Layer.provideMerge` for dependent layers.

#### Test Layers
Test layers (`src/layers/test/`) provide mock implementations using `Layer.succeed`:
- **ConfigTest** - Mock configuration with test tokens
- **DockerTest** - Predictable command responses
- **ClaudeTest** - Mock streaming events
- **GitTest** - Mock git operations
- **DashboardTest** - Mock state management

Combined in **TestLive** for integration testing:
```typescript
// src/layers/test/index.ts
export const TestLive = Layer.mergeAll(
  ConfigTest, DockerTest, GitTest, ClaudeTest, DashboardTest
)
```

### Errors

All errors use `Data.TaggedError` with `_tag` discriminators for type-safe error handling:

```typescript
// src/errors/index.ts
class ConfigError extends Data.TaggedError("ConfigError")<{
  variable: string
  message: string
}> {}

class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

// ... 8 more error types
```

Error handling pattern:
```typescript
yield* someEffect.pipe(
  Effect.mapError((e) => new SpecificError({ field: value }))
)
```

Use `Effect.catchTag` to handle specific error types:
```typescript
program.pipe(
  Effect.catchTag("TimeoutError", (e) => handleTimeout(e)),
  Effect.catchTag("DockerError", (e) => handleDockerFailure(e))
)
```

### Streams

Stream utilities (`src/streams/ndjson.ts`) for parsing and processing:
- **parseNDJSON** - Parse NDJSON streams (used by ClaudeService)
- **parseNDJSONWithFallback** - Parse with text fallback for mixed streams
- **fromReadableStream** - Wrap WHATWG ReadableStream in Effect Stream
- **collectAll** - Collect stream values into array
- **forEach** - Process stream with side effects

### Main Program

- **src/main.ts** - Entry point that parses CLI args and runs with BunRuntime
- **src/program.ts** - Orchestration logic:
  - `createSession()` - Creates and configures container
  - `runIteration()` - Executes Claude and pushes changes
  - `mainLoop()` - Iterates until all features pass (with circuit breaker)

Dependency injection flow:
```
main.ts → MainLive(args, containerName, state) → Effect.provide → BunRuntime.runMain
```

### File Reference

| Purpose | Path |
|---------|------|
| Services (interfaces) | `src/services/*.ts` |
| Live layers (production) | `src/layers/*.ts` |
| Test layers (mocks) | `src/layers/test/*.ts` |
| Error types | `src/errors/index.ts` |
| Stream utilities | `src/streams/ndjson.ts` |
| Main entry point | `src/main.ts` |
| Orchestration logic | `src/program.ts` |

## IMPORTANT to Reference the SPEC Documentation for relevant context.
### specs/
- full project specification. README.md is the lookup table. 
