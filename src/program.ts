// Main program orchestration using Effect
import { Effect } from "effect"
import { DockerService, type ContainerConfig } from "./services/Docker.js"
import { ConfigService } from "./services/Config.js"
import { generateContainerName, type SessionConfig } from "./container.js"
import { DockerError } from "./errors/index.js"

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
