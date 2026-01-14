#!/usr/bin/env bun
// Ralph Orchestrator - Simple loop, Claude picks features
// Per Anthropic best practices: simple loop, file-based state, no JSON output

import { parseArgs } from "./src/args"
import {
  generateContainerName,
  parseStaleContainers,
  parseContainerRunning,
  getRemainingFeatures,
  hasUnpushedCommits,
} from "./src/container"
import {
  startDashboardServer,
  updateState,
  updateIteration,
  updateFeatures,
  sendOutput,
  sendClaudeEvent,
  isPaused,
  isStepMode,
  isStopping,
  setStepMode,
  setStopping,
  setClaudeRunning,
  setPromptTemplate,
} from "./src/server"
import type { ClaudeEvent, Feature } from "./src/types"

const TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes per iteration
const MAX_NO_CHANGE = 3           // Circuit breaker: 3 iterations with no git diff

// IMPORTANT: This script must be run from ~/ralph/ directory
// The templates are resolved relative to this script's location
const RALPH_HOME = import.meta.dir

// === Signal Handling for Graceful Shutdown ===

let shutdownRequested = false

function setupSignalHandlers(dashboardEnabled: boolean): void {
  const handleShutdown = () => {
    if (shutdownRequested) {
      // Second signal = force exit
      console.log("\nForce shutdown - exiting immediately")
      process.exit(1)
    }
    shutdownRequested = true
    console.log("\nGraceful shutdown requested - waiting for Claude to finish...")
    console.log("Press Ctrl+C again to force exit")
    // Update dashboard state if running
    if (dashboardEnabled) {
      setStopping(true)
    }
  }

  process.on("SIGINT", handleShutdown)
  process.on("SIGTERM", handleShutdown)
}

// === Interactive CLI Prompt ===

async function promptForAction(): Promise<"continue" | "stop"> {
  process.stdout.write("\n[c]ontinue, [s]top: ")

  const stdin = Bun.stdin.stream()
  const reader = stdin.getReader()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return "stop"

      const input = new TextDecoder().decode(value).trim().toLowerCase()

      if (input === "c" || input === "continue" || input === "") {
        console.log("Continuing...")
        return "continue"
      }
      if (input === "s" || input === "stop") {
        console.log("Stopping...")
        return "stop"
      }
      process.stdout.write("[c]ontinue, [s]top: ")
    }
  } finally {
    reader.releaseLock()
  }
}

// === Cleanup and Error Handling ===

async function cleanupStaleContainers(): Promise<void> {
  const stale = await Bun.$`docker ps -a --filter name=ralph-session --format "{{.Names}}"`.text()
  for (const name of parseStaleContainers(stale)) {
    console.log(`Cleaning up stale container: ${name}`)
    await Bun.$`docker rm -f ${name}`.quiet().nothrow()
  }
}

async function ensureContainerRunning(containerName: string): Promise<boolean> {
  const isRunning = await Bun.$`docker inspect -f '{{.State.Running}}' ${containerName}`.text().catch(() => "false")
  if (!parseContainerRunning(isRunning)) {
    console.log("Container stopped unexpectedly, restarting...")
    const result = await Bun.$`docker start ${containerName}`.nothrow()
    return result.exitCode === 0
  }
  return true
}

// === Container Lifecycle Management ===

async function createSession(gitRoot: string, branch: string, isResume: boolean): Promise<string> {
  const containerName = generateContainerName()

  // Get GitHub token for private repo access (needed for resume/push)
  const githubToken = process.env.GITHUB_TOKEN ||
    await Bun.$`gh auth token`.text().catch(() => "")

  // Create container (does not start it)
  await Bun.$`docker create \
    --name ${containerName} \
    --cap-add=NET_ADMIN \
    -v ${process.env.HOME}/.ssh:/home/node/.ssh:ro \
    -v ${process.env.HOME}/.claude:/home/node/.claude:rw \
    -v ${process.env.HOME}/.gitconfig:/home/node/.gitconfig:ro \
    -e CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN} \
    -e GITHUB_TOKEN=${githubToken.trim()} \
    -e GIT_AUTHOR_NAME=${process.env.GIT_AUTHOR_NAME || 'Ralph'} \
    -e GIT_AUTHOR_EMAIL=${process.env.GIT_AUTHOR_EMAIL || 'ralph@localhost'} \
    -w /workspace \
    ralph-base:latest \
    sleep infinity`

  // Start container (runs entrypoint with firewall init)
  await Bun.$`docker start ${containerName}`

  // Wait for entrypoint to complete (firewall init + git setup)
  // The entrypoint prints "=== Ralph Firewall Ready ===" when done
  console.log("Waiting for container initialization...")
  for (let i = 0; i < 30; i++) {
    const logs = await Bun.$`docker logs ${containerName} 2>&1`.text()
    if (logs.includes("Ralph Firewall Ready")) break
    await Bun.sleep(1000)
  }

  // Copy project into container (exclude macOS AppleDouble files)
  // COPYFILE_DISABLE=1 prevents macOS tar from including resource forks (._* files)
  console.log("Copying project into container...")
  await Bun.$`COPYFILE_DISABLE=1 tar -C ${gitRoot} --exclude='._*' --exclude='.DS_Store' -cf - . | docker exec -i ${containerName} tar -xf - -C /workspace`

  // Fix ownership - files are extracted as root, but node user needs write access
  await Bun.$`docker exec ${containerName} chown -R node:node /workspace`

  // Fix git ownership issues (files copied as root, git runs as node)
  // Use --system config (not --global) since .gitconfig is mounted read-only
  await Bun.$`docker exec ${containerName} git config --system --add safe.directory /workspace`

  // Ensure git credential helper is configured (in case entrypoint didn't run it)
  if (githubToken.trim()) {
    await Bun.$`docker exec ${containerName} git config --system credential.helper '!gh auth git-credential'`
  }

  if (isResume) {
    // Fetch and checkout existing branch from remote
    console.log(`Resuming branch: ${branch}`)
    await Bun.$`docker exec -u node ${containerName} git fetch origin ${branch}`
    await Bun.$`docker exec -u node ${containerName} git checkout -B ${branch} origin/${branch}`
  } else {
    // Create new branch
    await Bun.$`docker exec -u node ${containerName} git checkout -b ${branch}`
  }

  return containerName
}

async function cleanupSession(containerName: string): Promise<void> {
  console.log(`Cleaning up container: ${containerName}`)
  await Bun.$`docker rm -f ${containerName}`.quiet().nothrow()
}

async function runClaudeInContainer(
  containerName: string,
  prompt: string,
  timeoutMs: number,
  dashboardEnabled: boolean
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (dashboardEnabled) {
      // Capture stdout and stream to both console and dashboard
      // Use --output-format stream-json for structured events
      const proc = Bun.spawn([
        "docker", "exec", "-u", "node", containerName,
        "claude", "-p", "--dangerously-skip-permissions",
        "--verbose", "--output-format", "stream-json",
        prompt
      ], { signal: controller.signal, stdout: "pipe", stderr: "pipe" })

      // Stream stdout as NDJSON and parse structured events
      const streamNDJSON = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""  // Keep incomplete line

          for (const line of lines) {
            if (!line.trim()) continue
            // Log raw line to console for debugging
            console.log(line)
            try {
              const event = JSON.parse(line) as ClaudeEvent
              sendClaudeEvent(event)
            } catch {
              // If not valid JSON, send as raw output (fallback)
              sendOutput(line + "\n")
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          console.log(buffer)
          try {
            const event = JSON.parse(buffer) as ClaudeEvent
            sendClaudeEvent(event)
          } catch {
            sendOutput(buffer + "\n")
          }
        }
      }

      // Stream stderr as raw text (for errors)
      const streamStderr = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          process.stderr.write(text)
          sendOutput(text)
        }
      }

      // Process both stdout and stderr in parallel
      await Promise.all([
        streamNDJSON(proc.stdout),
        streamStderr(proc.stderr),
        proc.exited,
      ])
    } else {
      // Original behavior: inherit stdout/stderr
      const proc = Bun.spawn([
        "docker", "exec", "-u", "node", containerName,
        "claude", "-p", "--dangerously-skip-permissions", prompt
      ], { signal: controller.signal, stdout: "inherit", stderr: "inherit" })

      await proc.exited
    }
    return true
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      console.log("TIMEOUT: Claude killed after timeout")
      return false
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

async function main(): Promise<void> {
  const { featuresPath, branch: resumeBranch, once, maxIterations, dashboard, dashboardPort, step } = parseArgs(process.argv.slice(2))

  // Setup signal handlers for graceful shutdown
  setupSignalHandlers(dashboard)

  // Cleanup any stale containers from previous sessions
  await cleanupStaleContainers()

  // Validate environment
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.error("ERROR: CLAUDE_CODE_OAUTH_TOKEN not set")
    process.exit(1)
  }

  // Find git root (still needed for initial copy)
  const gitRoot = (await Bun.$`git rev-parse --show-toplevel`.text()).trim()
  if (!gitRoot) {
    console.error("ERROR: Not in a git repository")
    process.exit(1)
  }

  // Verify features.json exists
  const featuresFile = Bun.file(`${gitRoot}/${featuresPath}`)
  if (!await featuresFile.exists()) {
    console.error(`ERROR: Features file not found: ${featuresPath}`)
    process.exit(1)
  }

  // Determine branch name and detect resume mode
  const branch = resumeBranch || `ralph/${Date.now()}`
  let isResume = false

  if (resumeBranch) {
    // Check if branch exists on remote
    const remoteBranch = await Bun.$`git ls-remote --heads origin ${resumeBranch}`.text()
    if (remoteBranch.trim()) {
      isResume = true
      console.log(`Found existing branch on remote: ${resumeBranch}`)
    } else {
      console.error(`ERROR: Branch not found on remote: ${resumeBranch}`)
      process.exit(1)
    }
  }

  // Create and start container (runs firewall init ONCE)
  console.log(`\n=== Starting Ralph Session ===`)
  console.log(`Branch: ${branch}`)
  console.log(`Mode: ${isResume ? 'Resume' : 'New session'}`)
  const containerName = await createSession(gitRoot, branch, isResume)
  console.log(`Container: ${containerName}`)

  // Read instructions template
  const instructionsPath = `${RALPH_HOME}/templates/ralph-instructions.md`
  const instructions = await Bun.file(instructionsPath).text()

  // Start dashboard server if enabled
  if (dashboard) {
    const dashboardPath = `${RALPH_HOME}/dashboard/dist/index.html`
    startDashboardServer(dashboardPort, dashboardPath)
    setPromptTemplate(instructions)
    setStepMode(step)  // Initialize step mode from CLI flag
    updateState({
      running: true,
      containerName,
      branch,
    })
  }

  // Track step mode locally for non-dashboard mode
  let stepModeEnabled = step

  let iteration = 0
  let noChangeCount = 0

  try {
    // Main loop
    while (true) {
      // Check for graceful shutdown request
      if (shutdownRequested || (dashboard && isStopping())) {
        console.log("\n=== Graceful shutdown - exiting ===")
        break
      }

      // Check for pause (dashboard control)
      if (dashboard && isPaused()) {
        console.log("Paused - waiting for resume...")
        while (isPaused() && !isStopping()) {
          await Bun.sleep(500)
        }
        if (isStopping()) break
        console.log("Resumed")
      }

      iteration++

      if (iteration > maxIterations) {
        console.log(`\n=== Max iterations reached (${maxIterations}) ===`)
        break
      }

      console.log(`\n=== Iteration ${iteration}/${maxIterations} ===`)

      // Verify container is still running before proceeding
      if (!await ensureContainerRunning(containerName)) {
        console.log("ERROR: Failed to restart container, aborting session")
        break
      }

      // Check remaining features (read from container)
      const featuresJson = await Bun.$`docker exec -u node ${containerName} cat /workspace/${featuresPath}`.text()
      const remaining = getRemainingFeatures(featuresJson)

      // Parse full features list for dashboard
      if (dashboard) {
        try {
          const parsed = JSON.parse(featuresJson) as { features: Feature[] }
          updateFeatures(parsed.features)
          updateIteration(iteration, maxIterations, remaining.length)
        } catch {
          // Ignore parse errors
        }
      }

      if (remaining.length === 0) {
        console.log("\n=== All features complete! ===")
        // Mark PR as ready for review
        await Bun.$`docker exec -u node ${containerName} gh pr ready ${branch}`.quiet().nothrow()
        break
      }

      console.log(`${remaining.length} features remaining.`)

      // Write prompt to container
      const promptPath = `/workspace/.ralph-prompt.md`
      await Bun.$`docker exec -u node ${containerName} bash -c ${`cat > ${promptPath} << 'PROMPT_EOF'
${instructions}
PROMPT_EOF`}`

      // Run Claude inside container
      if (dashboard) setClaudeRunning(true)
      const success = await runClaudeInContainer(
        containerName,
        `Read .ralph-prompt.md and follow the instructions.`,
        TIMEOUT_MS,
        dashboard
      )
      if (dashboard) setClaudeRunning(false)

      if (!success) {
        noChangeCount++
        if (noChangeCount >= MAX_NO_CHANGE) {
          console.log("CIRCUIT BREAKER: No progress after timeouts")
          process.stdout.write("\x07")
          break
        }
        continue
      }

      // Check if Claude pushed (verify via git log)
      const pushCheck = await Bun.$`docker exec -u node ${containerName} git log origin/${branch}..HEAD --oneline`.text().catch(() => "")
      if (hasUnpushedCommits(pushCheck)) {
        console.log("WARNING: Unpushed commits detected - attempting to push...")
        const pushResult = await Bun.$`docker exec -u node ${containerName} git push`.nothrow()
        if (pushResult.exitCode !== 0) {
          console.log("WARNING: Push failed - may need manual intervention")
          noChangeCount++
        } else {
          console.log("Push succeeded (orchestrator retry)")
          noChangeCount = 0
        }
      } else {
        noChangeCount = 0
      }

      // === Post-iteration checkpoint for step mode ===
      const shouldStep = dashboard ? isStepMode() : stepModeEnabled

      if (shouldStep && !once) {
        console.log("\n=== Step mode: Iteration complete ===")

        if (dashboard) {
          // In dashboard mode, set paused and accept CLI or dashboard resume
          updateState({ paused: true })
          console.log("Paused - use dashboard or press [c]ontinue, [s]top")

          // Race between CLI input and dashboard resume
          const waitForResume = async (): Promise<"continue" | "stop"> => {
            while (isPaused() && !isStopping()) {
              await Bun.sleep(100)
            }
            return isStopping() ? "stop" : "continue"
          }

          const action = await Promise.race([promptForAction(), waitForResume()])

          if (action === "stop" || isStopping()) {
            console.log("\n=== Stopping at user request ===")
            break
          }
          updateState({ paused: false })
        } else {
          // Non-dashboard mode: pure CLI prompt
          const action = await promptForAction()
          if (action === "stop") {
            console.log("\n=== Stopping at user request ===")
            break
          }
        }
      }

      if (once) {
        console.log("\n=== Single iteration complete (--once flag) ===")
        break
      }
    }
  } finally {
    // Update dashboard state
    if (dashboard) {
      updateState({ running: false })
    }
    // Always cleanup container
    await cleanupSession(containerName)
  }

  console.log(`\nTo view PR: gh pr view ${branch}`)
}

main().catch(console.error)
