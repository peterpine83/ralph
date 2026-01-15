# Effect Errors Specification

**File**: `src/errors/index.ts`
**Purpose**: Type-safe error definitions using Effect's `Data.TaggedError`

## Error Design Principles

1. **Tagged unions**: Every error has a unique `_tag` discriminator
2. **Context preservation**: Errors include all relevant context for debugging
3. **Recoverable vs fatal**: Some errors can be caught and retried, others abort
4. **Human-readable messages**: Errors provide both technical and user-friendly messages

## Error Hierarchy

```
RalphError (conceptual base)
├── ConfigError          # Configuration/environment issues
├── DockerError          # Container operations
├── ContainerNotFoundError
├── ClaudeError          # Claude CLI execution
├── TimeoutError         # Operation timeouts
├── GitError             # Git operations
├── FeatureError         # Feature file parsing
├── CircuitBreakerError  # Loop termination
├── StreamError          # NDJSON parsing
└── ValidationError      # Input validation
```

## Error Definitions

### ConfigError

Raised when configuration is missing or invalid.

```typescript
import { Data } from "effect"

class ConfigError extends Data.TaggedError("ConfigError")<{
  variable: string
  message: string
}> {}

// Usage
new ConfigError({
  variable: "CLAUDE_CODE_OAUTH_TOKEN",
  message: "Required environment variable not set"
})
```

**Recovery**: Fatal - application cannot start without valid config.

---

### DockerError

Raised when Docker commands fail.

```typescript
class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

// Usage
new DockerError({
  command: "create",
  exitCode: 1,
  stderr: "Error: No such image: ralph-base:latest"
})
```

**Recovery**: Depends on command. Container start failures can retry.

---

### ContainerNotFoundError

Raised when a container doesn't exist.

```typescript
class ContainerNotFoundError extends Data.TaggedError("ContainerNotFoundError")<{
  container: string
}> {}

// Usage
new ContainerNotFoundError({ container: "ralph-1704067200000" })
```

**Recovery**: Create a new container.

---

### ClaudeError

Raised when Claude CLI execution fails.

```typescript
class ClaudeError extends Data.TaggedError("ClaudeError")<{
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

// Usage
new ClaudeError({
  exitCode: 1,
  stderr: "Authentication failed"
})
```

**Recovery**: Retry with backoff, eventually abort.

---

### TimeoutError

Raised when an operation exceeds its time limit.

```typescript
class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string
  durationMs: number
}> {}

// Usage
new TimeoutError({
  operation: "claude",
  durationMs: 300000
})
```

**Recovery**: Increment no-change counter, continue to next iteration.

---

### GitError

Raised when git operations fail.

```typescript
class GitError extends Data.TaggedError("GitError")<{
  operation: "fetch" | "push" | "checkout" | "log" | "createBranch" | "config"
  stderr?: string
  cause?: unknown
}> {}

// Usage
new GitError({
  operation: "push",
  stderr: "error: failed to push some refs"
})
```

**Recovery**: Log and continue (push failures don't abort the loop).

---

### FeatureError

Raised when features.json is invalid.

```typescript
class FeatureError extends Data.TaggedError("FeatureError")<{
  path: string
  message: string
  cause?: unknown
}> {}

// Usage
new FeatureError({
  path: "/workspace/features.json",
  message: "Invalid JSON: Unexpected token"
})
```

**Recovery**: Fatal - cannot proceed without valid features.

---

### CircuitBreakerError

Raised when the circuit breaker triggers.

```typescript
class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  iterations: number
  message: string
}> {}

// Usage
new CircuitBreakerError({
  iterations: 3,
  message: "No git changes for 3 consecutive iterations"
})
```

**Recovery**: Fatal - abort the session.

---

### StreamError

Raised when stream parsing fails.

```typescript
class StreamError extends Data.TaggedError("StreamError")<{
  message: string
  line?: string
  cause?: unknown
}> {}

// Usage
new StreamError({
  message: "Invalid JSON in NDJSON stream",
  line: '{"type": "assistant", broken',
  cause: new SyntaxError("Unexpected end of JSON input")
})
```

**Recovery**: Skip invalid lines, continue parsing.

---

### ValidationError

Raised when input validation fails.

```typescript
class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  value: unknown
  message: string
}> {}

// Usage
new ValidationError({
  field: "maxIterations",
  value: "abc",
  message: "Expected a number, got string"
})
```

**Recovery**: Fatal - reject invalid CLI arguments.

---

## Error Handling Patterns

### Using catchTag

Handle specific errors with `Effect.catchTag`:

```typescript
const program = Effect.gen(function* () {
  yield* docker.create(config)
}).pipe(
  Effect.catchTag("DockerError", (e) =>
    Effect.logError(`Docker failed: ${e.command} (exit ${e.exitCode})`)
  )
)
```

### Using catchTags

Handle multiple error types:

```typescript
const program = mainLoop.pipe(
  Effect.catchTags({
    ConfigError: (e) =>
      Effect.die(`Configuration error: ${e.variable} - ${e.message}`),
    CircuitBreakerError: (e) =>
      Effect.logWarning(`Circuit breaker: ${e.message}`),
    TimeoutError: (e) =>
      Effect.logWarning(`Timeout after ${e.durationMs}ms: ${e.operation}`)
  })
)
```

### Retry with Schedule

Retry transient errors with backoff:

```typescript
const withRetry = docker.exec(container, cmd).pipe(
  Effect.retry(
    Schedule.exponential(1000).pipe(
      Schedule.compose(Schedule.recurs(3)),
      Schedule.whileInput((e: DockerError) => e.command === "exec")
    )
  )
)
```

### Error Context Enrichment

Add context when re-throwing:

```typescript
const enriched = docker.exec(container, ["git", "push"]).pipe(
  Effect.mapError((e) =>
    new GitError({
      operation: "push",
      cause: e
    })
  )
)
```

---

## Complete Error Module

```typescript
// src/errors/index.ts
import { Data } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  variable: string
  message: string
}> {}

export class DockerError extends Data.TaggedError("DockerError")<{
  command: string
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

export class ContainerNotFoundError extends Data.TaggedError("ContainerNotFoundError")<{
  container: string
}> {}

export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  exitCode?: number
  stderr?: string
  cause?: unknown
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string
  durationMs: number
}> {}

export class GitError extends Data.TaggedError("GitError")<{
  operation: "fetch" | "push" | "checkout" | "log" | "createBranch" | "config"
  stderr?: string
  cause?: unknown
}> {}

export class FeatureError extends Data.TaggedError("FeatureError")<{
  path: string
  message: string
  cause?: unknown
}> {}

export class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  iterations: number
  message: string
}> {}

export class StreamError extends Data.TaggedError("StreamError")<{
  message: string
  line?: string
  cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  value: unknown
  message: string
}> {}

// Union type for all Ralph errors
export type RalphError =
  | ConfigError
  | DockerError
  | ContainerNotFoundError
  | ClaudeError
  | TimeoutError
  | GitError
  | FeatureError
  | CircuitBreakerError
  | StreamError
  | ValidationError
```

---

## Error Categories

### Fatal Errors (Abort Session)

| Error | Condition |
|-------|-----------|
| ConfigError | Missing required env vars |
| FeatureError | Invalid features.json |
| CircuitBreakerError | 3 iterations without changes |
| ValidationError | Invalid CLI arguments |

### Recoverable Errors (Retry/Continue)

| Error | Recovery Action |
|-------|-----------------|
| DockerError | Retry with backoff |
| ClaudeError | Retry once, then continue |
| TimeoutError | Increment no-change counter |
| GitError | Log and continue |
| StreamError | Skip line, continue parsing |
| ContainerNotFoundError | Recreate container |

---

## Testing Errors

```typescript
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { DockerError, TimeoutError } from "./errors"

describe("error handling", () => {
  test("catchTag matches DockerError", async () => {
    const result = await Effect.fail(
      new DockerError({ command: "exec", exitCode: 1 })
    ).pipe(
      Effect.catchTag("DockerError", (e) =>
        Effect.succeed(`Caught: ${e.command}`)
      ),
      Effect.runPromise
    )

    expect(result).toBe("Caught: exec")
  })

  test("errors have correct _tag", () => {
    const error = new TimeoutError({ operation: "claude", durationMs: 5000 })
    expect(error._tag).toBe("TimeoutError")
  })
})
```
