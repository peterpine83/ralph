// Tests for Ralph error types - verify _tag discriminators and catchTag matching
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  ConfigError,
  DockerError,
  ContainerNotFoundError,
  ClaudeError,
  TimeoutError,
  GitError,
  FeatureError,
  CircuitBreakerError,
  StreamError,
  ValidationError,
} from "./index"

describe("ConfigError", () => {
  test("has correct _tag discriminator", () => {
    const error = new ConfigError({
      variable: "DOCKER_IMAGE",
      message: "Missing required environment variable",
    })
    expect(error._tag).toBe("ConfigError")
  })

  test("catchTag matches ConfigError", async () => {
    const result = await Effect.fail(
      new ConfigError({
        variable: "DOCKER_IMAGE",
        message: "Missing required environment variable",
      })
    ).pipe(
      Effect.catchTag("ConfigError", (e) =>
        Effect.succeed(`Caught: ${e.variable}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: DOCKER_IMAGE")
  })

  test("initializes properties correctly", () => {
    const error = new ConfigError({
      variable: "API_KEY",
      message: "Invalid API key format",
    })
    expect(error.variable).toBe("API_KEY")
    expect(error.message).toBe("Invalid API key format")
  })
})

describe("DockerError", () => {
  test("has correct _tag discriminator", () => {
    const error = new DockerError({
      command: "docker exec",
      exitCode: 1,
      stderr: "Container not running",
    })
    expect(error._tag).toBe("DockerError")
  })

  test("catchTag matches DockerError", async () => {
    const result = await Effect.fail(
      new DockerError({
        command: "docker exec",
        exitCode: 1,
      })
    ).pipe(
      Effect.catchTag("DockerError", (e) =>
        Effect.succeed(`Caught: ${e.command}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: docker exec")
  })

  test("initializes with optional properties", () => {
    const error = new DockerError({
      command: "docker run",
      exitCode: 137,
      stderr: "Out of memory",
      cause: new Error("OOM"),
    })
    expect(error.command).toBe("docker run")
    expect(error.exitCode).toBe(137)
    expect(error.stderr).toBe("Out of memory")
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe("ContainerNotFoundError", () => {
  test("has correct _tag discriminator", () => {
    const error = new ContainerNotFoundError({
      container: "ralph-container-123",
    })
    expect(error._tag).toBe("ContainerNotFoundError")
  })

  test("catchTag matches ContainerNotFoundError", async () => {
    const result = await Effect.fail(
      new ContainerNotFoundError({
        container: "ralph-container-123",
      })
    ).pipe(
      Effect.catchTag("ContainerNotFoundError", (e) =>
        Effect.succeed(`Caught: ${e.container}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: ralph-container-123")
  })

  test("initializes properties correctly", () => {
    const error = new ContainerNotFoundError({
      container: "my-container",
    })
    expect(error.container).toBe("my-container")
  })
})

describe("ClaudeError", () => {
  test("has correct _tag discriminator", () => {
    const error = new ClaudeError({
      exitCode: 1,
      stderr: "API connection failed",
    })
    expect(error._tag).toBe("ClaudeError")
  })

  test("catchTag matches ClaudeError", async () => {
    const result = await Effect.fail(
      new ClaudeError({
        exitCode: 1,
        stderr: "API connection failed",
      })
    ).pipe(
      Effect.catchTag("ClaudeError", (e) =>
        Effect.succeed(`Caught: exit ${e.exitCode}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: exit 1")
  })

  test("initializes with optional properties", () => {
    const error = new ClaudeError({
      exitCode: 2,
      stderr: "Rate limited",
      cause: new Error("429"),
    })
    expect(error.exitCode).toBe(2)
    expect(error.stderr).toBe("Rate limited")
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe("TimeoutError", () => {
  test("has correct _tag discriminator", () => {
    const error = new TimeoutError({
      operation: "claude run",
      durationMs: 30000,
    })
    expect(error._tag).toBe("TimeoutError")
  })

  test("catchTag matches TimeoutError", async () => {
    const result = await Effect.fail(
      new TimeoutError({
        operation: "claude run",
        durationMs: 30000,
      })
    ).pipe(
      Effect.catchTag("TimeoutError", (e) =>
        Effect.succeed(`Caught: ${e.operation} after ${e.durationMs}ms`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: claude run after 30000ms")
  })

  test("initializes properties correctly", () => {
    const error = new TimeoutError({
      operation: "docker exec",
      durationMs: 5000,
    })
    expect(error.operation).toBe("docker exec")
    expect(error.durationMs).toBe(5000)
  })
})

describe("GitError", () => {
  test("has correct _tag discriminator", () => {
    const error = new GitError({
      operation: "push",
      stderr: "Permission denied",
    })
    expect(error._tag).toBe("GitError")
  })

  test("catchTag matches GitError", async () => {
    const result = await Effect.fail(
      new GitError({
        operation: "push",
        stderr: "Permission denied",
      })
    ).pipe(
      Effect.catchTag("GitError", (e) =>
        Effect.succeed(`Caught: ${e.operation}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: push")
  })

  test("initializes with all operation types", () => {
    const operations = ["clone", "fetch", "push", "commit", "checkout", "status", "diff", "log", "branch"] as const
    operations.forEach((op) => {
      const error = new GitError({
        operation: op,
        stderr: "Test error",
      })
      expect(error.operation).toBe(op)
      expect(error._tag).toBe("GitError")
    })
  })

  test("initializes with optional properties", () => {
    const error = new GitError({
      operation: "commit",
      stderr: "Nothing to commit",
      cause: new Error("Empty"),
    })
    expect(error.operation).toBe("commit")
    expect(error.stderr).toBe("Nothing to commit")
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe("FeatureError", () => {
  test("has correct _tag discriminator", () => {
    const error = new FeatureError({
      featureId: "auth-001",
      message: "Feature verification failed",
    })
    expect(error._tag).toBe("FeatureError")
  })

  test("catchTag matches FeatureError", async () => {
    const result = await Effect.fail(
      new FeatureError({
        featureId: "auth-001",
        message: "Feature verification failed",
      })
    ).pipe(
      Effect.catchTag("FeatureError", (e) =>
        Effect.succeed(`Caught: ${e.featureId}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: auth-001")
  })

  test("initializes with optional cause", () => {
    const error = new FeatureError({
      featureId: "setup-001",
      message: "Installation failed",
      cause: new Error("Network error"),
    })
    expect(error.featureId).toBe("setup-001")
    expect(error.message).toBe("Installation failed")
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe("CircuitBreakerError", () => {
  test("has correct _tag discriminator", () => {
    const error = new CircuitBreakerError({
      iterations: 5,
      reason: "Max attempts exceeded",
    })
    expect(error._tag).toBe("CircuitBreakerError")
  })

  test("catchTag matches CircuitBreakerError", async () => {
    const result = await Effect.fail(
      new CircuitBreakerError({
        iterations: 5,
        reason: "Max attempts exceeded",
      })
    ).pipe(
      Effect.catchTag("CircuitBreakerError", (e) =>
        Effect.succeed(`Caught: ${e.iterations} iterations`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: 5 iterations")
  })

  test("initializes properties correctly", () => {
    const error = new CircuitBreakerError({
      iterations: 10,
      reason: "Feature keeps failing",
    })
    expect(error.iterations).toBe(10)
    expect(error.reason).toBe("Feature keeps failing")
  })
})

describe("StreamError", () => {
  test("has correct _tag discriminator", () => {
    const error = new StreamError({
      streamType: "ndjson",
      message: "Invalid JSON line",
    })
    expect(error._tag).toBe("StreamError")
  })

  test("catchTag matches StreamError", async () => {
    const result = await Effect.fail(
      new StreamError({
        streamType: "ndjson",
        message: "Invalid JSON line",
      })
    ).pipe(
      Effect.catchTag("StreamError", (e) =>
        Effect.succeed(`Caught: ${e.streamType}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: ndjson")
  })

  test("initializes with optional cause", () => {
    const error = new StreamError({
      streamType: "stdout",
      message: "Parse error",
      cause: new SyntaxError("Unexpected token"),
    })
    expect(error.streamType).toBe("stdout")
    expect(error.message).toBe("Parse error")
    expect(error.cause).toBeInstanceOf(SyntaxError)
  })
})

describe("ValidationError", () => {
  test("has correct _tag discriminator", () => {
    const error = new ValidationError({
      field: "email",
      message: "Invalid email format",
    })
    expect(error._tag).toBe("ValidationError")
  })

  test("catchTag matches ValidationError", async () => {
    const result = await Effect.fail(
      new ValidationError({
        field: "email",
        message: "Invalid email format",
      })
    ).pipe(
      Effect.catchTag("ValidationError", (e) =>
        Effect.succeed(`Caught: ${e.field}`)
      ),
      Effect.runPromise
    )
    expect(result).toBe("Caught: email")
  })

  test("initializes with optional value", () => {
    const error = new ValidationError({
      field: "age",
      message: "Age must be positive",
      value: -5,
    })
    expect(error.field).toBe("age")
    expect(error.message).toBe("Age must be positive")
    expect(error.value).toBe(-5)
  })
})

describe("Error type discrimination", () => {
  test("catchTags can handle multiple error types", async () => {
    const handleError = (errorType: "docker" | "timeout" | "git") =>
      Effect.gen(function* () {
        if (errorType === "docker") {
          yield* Effect.fail(new DockerError({ command: "docker run" }))
        } else if (errorType === "timeout") {
          yield* Effect.fail(new TimeoutError({ operation: "test", durationMs: 1000 }))
        } else {
          yield* Effect.fail(new GitError({ operation: "push" }))
        }
      }).pipe(
        Effect.catchTags({
          DockerError: (e) => Effect.succeed(`Docker: ${e.command}`),
          TimeoutError: (e) => Effect.succeed(`Timeout: ${e.operation}`),
          GitError: (e) => Effect.succeed(`Git: ${e.operation}`),
        })
      )

    const dockerResult = await Effect.runPromise(handleError("docker"))
    expect(dockerResult).toBe("Docker: docker run")

    const timeoutResult = await Effect.runPromise(handleError("timeout"))
    expect(timeoutResult).toBe("Timeout: test")

    const gitResult = await Effect.runPromise(handleError("git"))
    expect(gitResult).toBe("Git: push")
  })

  test("unhandled errors propagate correctly", async () => {
    const result = Effect.fail<ConfigError | DockerError>(
      new ConfigError({
        variable: "TEST",
        message: "Test error",
      })
    ).pipe(
      Effect.catchTag("DockerError", () => Effect.succeed("Should not catch")),
      Effect.catchTag("ConfigError", () => Effect.succeed("Caught ConfigError"))
    )

    const output = await Effect.runPromise(result)
    expect(output).toBe("Caught ConfigError")
  })
})
