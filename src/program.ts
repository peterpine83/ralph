// Main program orchestration using Effect
import { Effect } from "effect"
import { DockerService, type ContainerConfig } from "./services/Docker.js"
import { ConfigService } from "./services/Config.js"
import { generateContainerName, type SessionConfig, getRemainingFeatures } from "./container.js"
import { DockerError, CircuitBreakerError } from "./errors/index.js"
import { ClaudeService } from "./services/Claude.js"
import { GitService } from "./services/Git.js"

/**
 * Creates and initializes a new container session
 *
 * Steps:
 * 1. Generate unique container name
 * 2. Create container with required capabilities (NET_ADMIN for firewall)
 * 3. Start container (runs entrypoint.sh which initializes firewall)
 * 4. Wait for firewall initialization ("Ralph Firewall Ready")
 * 5. Clone project from remote repository
 * 6. Setup git configuration inside container
 * 7. Create or checkout branch
 * 8. Copy local features.json if needed
 */
export const createSession = (sessionConfig: SessionConfig) =>
  Effect.gen(function* () {
    const docker = yield* DockerService
    const config = yield* ConfigService

    // 1. Generate unique container name
    const containerName = generateContainerName()

    // 2. Create container with proper configuration
    const containerConfig: ContainerConfig = {
      name: containerName,
      image: "ralph-base:latest",
      capAdd: ["NET_ADMIN"], // Required for firewall setup
      volumes: [
        `${process.env.HOME}/.ssh:/root/.ssh:ro`, // SSH keys for git operations
      ],
      env: [
        `CLAUDE_CODE_OAUTH_TOKEN=${config.oauthToken}`,
        `GITHUB_TOKEN=${config.githubToken}`,
      ],
      workdir: "/workspace",
    }

    // Create the container (docker create)
    const containerId = yield* docker.create(containerConfig).pipe(
      Effect.mapError(
        (e) =>
          new DockerError({
            command: "create",
            cause: e,
          })
      )
    )

    // 3. Start the container (runs entrypoint.sh)
    yield* docker.start(containerName).pipe(
      Effect.mapError(
        (e) =>
          new DockerError({
            command: "start",
            cause: e,
          })
      )
    )

    // 4. Wait for firewall initialization
    // The entrypoint.sh script prints "Ralph Firewall Ready" when complete
    // This typically takes a few seconds as it resolves domains and sets up iptables
    // For now, we'll use a simple sleep approach
    // TODO: Implement proper log streaming to detect "Ralph Firewall Ready" message
    yield* Effect.sleep("3 seconds")

    // 5. Clone project from remote repository
    // Clone to /tmp/repo first, then copy to /workspace to avoid permission issues
    yield* docker
      .exec(
        containerName,
        `git clone --branch ${sessionConfig.branch} ${sessionConfig.gitRoot} /tmp/repo`
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "git clone",
              cause: e,
            })
        )
      )

    // Copy from /tmp/repo to /workspace
    yield* docker
      .exec(containerName, "cp -a /tmp/repo/. /workspace/")
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "copy to workspace",
              cause: e,
            })
        )
      )

    // Fix permissions (workspace should be owned by node user)
    yield* docker
      .exec(containerName, "chown -R node:node /workspace")
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "chown",
              cause: e,
            })
        )
      )

    // 6. Setup git configuration inside container
    // Configure safe.directory
    yield* docker
      .exec(
        containerName,
        "git config --system safe.directory /workspace"
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "git config safe.directory",
              cause: e,
            })
        )
      )

    // Configure credential helper for GitHub CLI
    yield* docker
      .exec(
        containerName,
        "git config --system credential.helper '!gh auth git-credential'"
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "git config credential.helper",
              cause: e,
            })
        )
      )

    // Configure SSH command for git operations
    yield* docker
      .exec(
        containerName,
        'git config --system core.sshCommand "ssh -i /tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"'
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "git config sshCommand",
              cause: e,
            })
        )
      )

    // 7. Create or checkout branch
    if (sessionConfig.isResume) {
      // Resume: checkout existing branch from remote
      yield* docker
        .exec(containerName, `git checkout ${sessionConfig.branch}`)
        .pipe(
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "git checkout",
                cause: e,
              })
          )
        )
    } else {
      // New session: create new branch
      yield* docker
        .exec(containerName, `git checkout -b ${sessionConfig.branch}`)
        .pipe(
          Effect.mapError(
            (e) =>
              new DockerError({
                command: "git checkout -b",
                cause: e,
              })
          )
        )
    }

    // Return the container name for use in subsequent operations
    return { containerName, containerId }
  })

/**
 * Runs a single iteration of the orchestration loop
 *
 * Steps:
 * 1. Read features.json from container
 * 2. Check if there are remaining features to implement
 * 3. Run Claude Code with the prompt
 * 4. Check for git changes (unpushed commits)
 * 5. Push changes if they exist
 *
 * Returns information about what happened in this iteration
 */
export const runIteration = (params: {
  containerName: string
  prompt: string
}) =>
  Effect.gen(function* () {
    const docker = yield* DockerService
    const claude = yield* ClaudeService
    const git = yield* GitService

    // 1. Read features.json from container
    const featuresContent = yield* docker
      .readFile(params.containerName, "/workspace/.ralph/features.json")
      .pipe(
        Effect.mapError(
          (e) =>
            new DockerError({
              command: "readFile",
              cause: e,
            })
        )
      )

    // 2. Check remaining features
    const remainingFeatures = getRemainingFeatures(featuresContent)

    // 3. Run Claude Code with the prompt
    // Use a 10 minute timeout for Claude operations
    yield* claude.run({
      containerName: params.containerName,
      prompt: params.prompt,
      timeoutMs: 10 * 60 * 1000,
      flags: {
        dangerouslySkipPermissions: true,
        verbose: true,
        outputFormat: "stream-json",
      },
      user: "node",
    })

    // 4. Check for git changes (unpushed commits)
    const hasChanges = yield* git.hasUnpushedCommits()

    // 5. Push changes if they exist
    if (hasChanges) {
      yield* git.push({ setUpstream: true })
    }

    // Return iteration results
    return {
      remainingFeaturesCount: remainingFeatures.length,
      gitChangesPushed: hasChanges,
    }
  })

/**
 * Main orchestration loop using Effect.iterate
 *
 * The loop continues while:
 * - There are remaining features to implement
 * - Circuit breaker hasn't triggered (< 3 consecutive no-change iterations)
 *
 * Each iteration:
 * 1. Calls runIteration to execute Claude and push changes
 * 2. Tracks whether git changes were pushed
 * 3. Increments noChangeCount if no changes, resets if changes detected
 * 4. Triggers CircuitBreakerError after 3 consecutive no-change iterations
 *
 * Returns when all features pass or circuit breaker triggers
 */
export const mainLoop = (params: {
  containerName: string
  prompt: string
}) =>
  Effect.gen(function* () {
    // Use Effect.iterate for the orchestration loop
    const finalState = yield* Effect.iterate(
      // Initial state
      { iteration: 0, noChangeCount: 0, remainingFeaturesCount: 0 },
      {
        // Continue while there are features remaining and circuit breaker hasn't triggered
        while: (state) =>
          state.remainingFeaturesCount > 0 && state.noChangeCount < 3,

        // Body: execute one iteration
        body: (state) =>
          Effect.gen(function* () {
            // Run one iteration
            const result = yield* runIteration({
              containerName: params.containerName,
              prompt: params.prompt,
            })

            // Update noChangeCount based on whether changes were pushed
            const newNoChangeCount = result.gitChangesPushed
              ? 0 // Reset if changes detected
              : state.noChangeCount + 1 // Increment if no changes

            // Return next state
            return {
              iteration: state.iteration + 1,
              noChangeCount: newNoChangeCount,
              remainingFeaturesCount: result.remainingFeaturesCount,
            }
          }),
      }
    )

    // Check if circuit breaker was triggered
    if (finalState.noChangeCount >= 3) {
      return yield* Effect.fail(
        new CircuitBreakerError({
          iterations: finalState.iteration,
          reason: `No git changes pushed for ${finalState.noChangeCount} consecutive iterations`,
        })
      )
    }

    // Successfully completed all features
    return finalState
  })
