import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { mainLoop, runIteration } from "./program.js"
import { TestLive } from "./layers/test/index.js"
import { DockerService } from "./services/Docker.js"
import { ClaudeService } from "./services/Claude.js"
import { GitService } from "./services/Git.js"

/**
 * Integration tests for mainLoop and runIteration
 *
 * These tests use the TestLive layer to mock all service dependencies
 * and verify the orchestration logic behaves correctly.
 */

describe("runIteration", () => {
  test("completes successfully with remaining features", async () => {
    // Mock features.json with 2 remaining features
    const mockFeaturesJson = JSON.stringify({
      features: [
        { id: "feature-001", passes: true },
        { id: "feature-002", passes: false },
        { id: "feature-003", passes: false },
      ],
    })

    // Create custom test layer with mock implementations
    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: (_containerName: string, _path: string) =>
          Effect.succeed(mockFeaturesJson),
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        hasUnpushedCommits: () => Effect.succeed(true),
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    const result = await Effect.runPromise(
      runIteration({
        containerName: "test-container",
        prompt: "Test prompt",
      }).pipe(Effect.provide(testLayer))
    )

    expect(result.remainingFeaturesCount).toBe(2)
    expect(result.gitChangesPushed).toBe(true)
  })

  test("reports no git changes when hasUnpushedCommits is false", async () => {
    const mockFeaturesJson = JSON.stringify({
      features: [{ id: "feature-001", passes: false }],
    })

    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: () => Effect.succeed(mockFeaturesJson),
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        hasUnpushedCommits: () => Effect.succeed(false),
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    const result = await Effect.runPromise(
      runIteration({
        containerName: "test-container",
        prompt: "Test prompt",
      }).pipe(Effect.provide(testLayer))
    )

    expect(result.gitChangesPushed).toBe(false)
  })
})

describe("mainLoop", () => {
  test("completes successfully when all features pass", async () => {
    // Scenario: All features already pass
    const mockFeaturesJson = JSON.stringify({
      features: [
        { id: "feature-001", passes: true },
        { id: "feature-002", passes: true },
      ],
    })

    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: () => Effect.succeed(mockFeaturesJson),
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        hasUnpushedCommits: () => Effect.succeed(false),
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    const result = await Effect.runPromise(
      mainLoop({
        containerName: "test-container",
        prompt: "Test prompt",
      }).pipe(Effect.provide(testLayer))
    )

    // Should complete after one iteration that discovers 0 remaining features
    // The loop always runs at least once to check the actual feature count
    expect(result.iteration).toBe(1)
    expect(result.remainingFeaturesCount).toBe(0)
    expect(result.noChangeCount).toBe(1) // No changes pushed
  })

  test("progresses through iterations until features complete", async () => {
    let iterationCount = 0

    // Mock features that progressively complete:
    // Iteration 1: 2 remaining
    // Iteration 2: 1 remaining
    // Iteration 3: 0 remaining (all pass)
    const getMockFeaturesJson = () => {
      iterationCount++
      if (iterationCount === 1) {
        return JSON.stringify({
          features: [
            { id: "feature-001", passes: false },
            { id: "feature-002", passes: false },
          ],
        })
      } else if (iterationCount === 2) {
        return JSON.stringify({
          features: [
            { id: "feature-001", passes: true },
            { id: "feature-002", passes: false },
          ],
        })
      } else {
        return JSON.stringify({
          features: [
            { id: "feature-001", passes: true },
            { id: "feature-002", passes: true },
          ],
        })
      }
    }

    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: () => Effect.succeed(getMockFeaturesJson()),
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        hasUnpushedCommits: () => Effect.succeed(true),
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    const result = await Effect.runPromise(
      mainLoop({
        containerName: "test-container",
        prompt: "Test prompt",
      }).pipe(Effect.provide(testLayer))
    )

    // Should complete after 3 iterations:
    // Iteration 1: 2 remaining, changes pushed
    // Iteration 2: 1 remaining, changes pushed
    // Iteration 3: 0 remaining (exits)
    expect(result.iteration).toBe(3)
    expect(result.remainingFeaturesCount).toBe(0)
    expect(result.noChangeCount).toBe(0)
  })

  test("triggers circuit breaker after 3 consecutive no-change iterations", async () => {
    // Mock features that never complete
    const mockFeaturesJson = JSON.stringify({
      features: [{ id: "feature-001", passes: false }],
    })

    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: () => Effect.succeed(mockFeaturesJson),
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        // No git changes detected
        hasUnpushedCommits: () => Effect.succeed(false),
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    // Test using Effect.catchTag to verify it's a CircuitBreakerError
    const result = await mainLoop({
      containerName: "test-container",
      prompt: "Test prompt",
    }).pipe(
      Effect.catchTag("CircuitBreakerError", (e) =>
        Effect.succeed({
          caught: true,
          iterations: e.iterations,
          reason: e.reason,
        })
      ),
      Effect.provide(testLayer),
      Effect.runPromise
    )

    // Verify it was a CircuitBreakerError that was caught
    expect((result as any).caught).toBe(true)
    expect((result as any).iterations).toBe(3)
    expect((result as any).reason).toContain("No git changes pushed for 3 consecutive iterations")
  })

  test("resets noChangeCount when git changes are detected", async () => {
    let iterationCount = 0

    // Features never complete, but git changes alternate
    const mockFeaturesJson = JSON.stringify({
      features: [{ id: "feature-001", passes: false }],
    })

    // Alternate between changes and no changes:
    // Iteration 1: changes (noChangeCount = 0)
    // Iteration 2: no changes (noChangeCount = 1)
    // Iteration 3: changes (noChangeCount = 0 - reset!)
    // Iteration 4: no changes (noChangeCount = 1)
    // ... continues until we manually stop at 5 iterations
    const hasChanges = () => {
      iterationCount++
      // Return true on odd iterations, false on even
      return Effect.succeed(iterationCount % 2 === 1)
    }

    const testLayer = Layer.mergeAll(
      TestLive,
      Layer.succeed(DockerService, {
        create: () => Effect.succeed("mock-container-id"),
        start: () => Effect.succeed(undefined),
        remove: () => Effect.succeed(undefined),
        inspect: () => Effect.succeed({ running: true }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        execStream: () => ({
          stdout: Effect.succeed(Effect.fail("not implemented")),
          stderr: Effect.succeed(Effect.fail("not implemented")),
        }),
        readFile: () => {
          // After 5 iterations, mark feature as complete to stop the loop
          if (iterationCount >= 5) {
            return Effect.succeed(
              JSON.stringify({
                features: [{ id: "feature-001", passes: true }],
              })
            )
          }
          return Effect.succeed(mockFeaturesJson)
        },
        writeFile: () => Effect.succeed(undefined),
        listByPrefix: () => Effect.succeed([]),
      } as any),
      Layer.succeed(ClaudeService, {
        run: () => Effect.succeed(undefined),
        runWithEvents: () => Effect.fail("not implemented") as any,
      } as any),
      Layer.succeed(GitService, {
        checkout: () => Effect.succeed(undefined),
        fetch: () => Effect.succeed(undefined),
        push: () => Effect.succeed(undefined),
        hasUnpushedCommits: hasChanges,
        createBranch: () => Effect.succeed(undefined),
        configureUser: () => Effect.succeed(undefined),
      } as any)
    )

    const result = await Effect.runPromise(
      mainLoop({
        containerName: "test-container",
        prompt: "Test prompt",
      }).pipe(Effect.provide(testLayer))
    )

    // Should complete after 6 iterations without triggering circuit breaker:
    // Iteration 1: changes (noChangeCount = 0)
    // Iteration 2: no changes (noChangeCount = 1)
    // Iteration 3: changes (noChangeCount = 0 - reset!)
    // Iteration 4: no changes (noChangeCount = 1)
    // Iteration 5: changes (noChangeCount = 0 - reset!)
    // Iteration 6: feature complete, exits
    expect(result.iteration).toBe(6)
    expect(result.noChangeCount).toBeLessThan(3)
  })
})
