#!/usr/bin/env bun
// Ralph Orchestrator - Thin wrapper delegating to Effect-based implementation
// Maintains CLI compatibility while using the new architecture in src/main.ts

/**
 * This file is now a thin wrapper around the Effect-based implementation.
 * The actual orchestration logic lives in src/main.ts and src/program.ts.
 *
 * For now, we preserve the original implementation here for backwards compatibility
 * while the Effect-based version is being developed. Once src/main.ts is fully
 * functional, this wrapper can be simplified to just:
 *
 *   import { main } from "./src/main.js"
 *   main()
 */

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
  setOnStopCallback,
} from "./src/server"
import type { ClaudeEvent, Feature } from "./src/types"

// Future: Once Effect-based implementation is complete, use this instead:
// import "./src/main.js"  // Effect-based main (currently in development)

const TIMEOUT_MS = 60 * 60 * 1000      // 1 hour safety fallback (Claude Code handles its own timeouts)
const MAX_NO_CHANGE = 3                // Circuit breaker: 3 iterations with no git diff

// Generate human-readable branch name: ralph/MMDD-HHMM-{feature-slug}
function generateBranchName(features: Feature[]): string {
  const now = new Date()
  const date = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

  // Get first feature ID, truncate to 25 chars for reasonable branch length
  const firstFeature = features[0]?.id || 'unknown'
  const slug = firstFeature.slice(0, 25).replace(/[^a-z0-9-]/gi, '-').toLowerCase()

  return `ralph/${date}-${time}-${slug}`
}

// Generate branch name for plan mode: ralph/MMDD-HHMM-plan
function generatePlanBranchName(): string {
  const now = new Date()
  const date = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  return `ralph/${date}-${time}-plan`
}

// IMPORTANT: This script must be run from ~/ralph/ directory
// The templates are resolved relative to this script's location
const RALPH_HOME = import.meta.dir

// === Signal Handling for Graceful Shutdown ===

let shutdownRequested = false
let claudeAbortController: AbortController | null = null

// Called by server when stop button is clicked
export function abortClaude(): void {
  claudeAbortController?.abort()
}

function setupSignalHandlers(dashboardEnabled: boolean): void {
  const handleShutdown = () => {
    if (shutdownRequested) {
      // Second signal = force exit
      console.log("\nForce shutdown - exiting immediately")
      process.exit(1)
    }
    shutdownRequested = true
    console.log("\nShutdown requested - stopping Claude...")
    abortClaude()  // Kill Claude immediately
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

async function createSession(gitRoot: string, branch: string, isResume: boolean, featuresPath: string, mode: "plan" | "build"): Promise<string> {
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
    -e CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN || ''} \
    -e ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''} \
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

  // Fix git ownership issues (files will be owned by node user)
  // Use --system config (not --global) since .gitconfig is mounted read-only
  await Bun.$`docker exec ${containerName} git config --system --add safe.directory /workspace`

  // Ensure git credential helper is configured (in case entrypoint didn't run it)
  if (githubToken.trim()) {
    await Bun.$`docker exec ${containerName} git config --system credential.helper '!gh auth git-credential'`
  }

  // Always clone from remote to ensure clean state (no local uncommitted changes)
  const remoteUrl = (await Bun.$`git remote get-url origin`.text()).trim()
  const cloneBranch = isResume ? branch : "trunk"

  console.log(isResume ? `Resuming branch: ${branch}` : `Starting new session from trunk`)
  console.log(`Cloning from remote: ${remoteUrl}`)

  // Clone to temp dir then copy contents (can't clone directly into existing /workspace)
  await Bun.$`docker exec -u node ${containerName} git clone --branch ${cloneBranch} ${remoteUrl} /tmp/repo`
  await Bun.$`docker exec ${containerName} cp -a /tmp/repo/. /workspace/`
  await Bun.$`docker exec ${containerName} rm -rf /tmp/repo`
  await Bun.$`docker exec ${containerName} chown -R node:node /workspace`

  if (!isResume) {
    // New session: create the feature branch from trunk
    await Bun.$`docker exec -u node ${containerName} git checkout -b ${branch}`

    // Copy features.json from local (only in build mode - plan mode doesn't need it)
    if (mode === "build") {
      const featuresContent = await Bun.file(`${gitRoot}/${featuresPath}`).text()
      await Bun.$`docker exec -u node ${containerName} mkdir -p /workspace/.ralph`
      await Bun.$`docker exec -u node ${containerName} bash -c ${`cat > /workspace/${featuresPath} << 'FEATURES_EOF'
${featuresContent}
FEATURES_EOF`}`
    } else {
      // Plan mode: just ensure .ralph directory exists
      await Bun.$`docker exec -u node ${containerName} mkdir -p /workspace/.ralph`
    }
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
  dashboardEnabled: boolean,
  externalSignal?: AbortSignal
): Promise<boolean> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)

  // Combine timeout signal with external signal (for stop button)
  const signal = externalSignal
    ? AbortSignal.any([timeoutController.signal, externalSignal])
    : timeoutController.signal

  try {
    if (dashboardEnabled) {
      // Capture stdout and stream to both console and dashboard
      // Use --output-format stream-json for structured events
      const proc = Bun.spawn([
        "docker", "exec", "-u", "node", containerName,
        "claude", "-p", "--dangerously-skip-permissions",
        "--model", "claude-opus-4-5-20251101",
        "--verbose", "--output-format", "stream-json",
        prompt
      ], { signal, stdout: "pipe", stderr: "pipe" })

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
        "claude", "-p", "--dangerously-skip-permissions",
        "--model", "claude-opus-4-5-20251101",
        prompt
      ], { signal, stdout: "inherit", stderr: "inherit" })

      await proc.exited
    }
    return true
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      // Could be timeout or user-initiated stop
      console.log("Claude process terminated")
      return false
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

async function main(): Promise<void> {
  const { featuresPath, branch: resumeBranch, once, maxIterations, dashboard, dashboardPort, step, mode } = parseArgs(process.argv.slice(2))

  // Setup signal handlers for graceful shutdown
  setupSignalHandlers(dashboard)

  // Cleanup any stale containers from previous sessions
  await cleanupStaleContainers()

  // Validate environment - need either OAuth token or API key
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY")
    process.exit(1)
  }

  // Find git root (still needed for initial copy)
  const gitRoot = (await Bun.$`git rev-parse --show-toplevel`.text()).trim()
  if (!gitRoot) {
    console.error("ERROR: Not in a git repository")
    process.exit(1)
  }

  // Verify features.json exists and parse it (only required for build mode)
  let featuresData: { features: Feature[] } = { features: [] }
  if (mode === "build") {
    const featuresFile = Bun.file(`${gitRoot}/${featuresPath}`)
    if (!await featuresFile.exists()) {
      console.error(`ERROR: Features file not found: ${featuresPath}`)
      process.exit(1)
    }
    featuresData = JSON.parse(await featuresFile.text()) as { features: Feature[] }
  }

  // Determine branch name and detect resume mode
  const branch = resumeBranch || (mode === "plan"
    ? generatePlanBranchName()
    : generateBranchName(featuresData.features))
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
  console.log(`Mode: ${mode} (${isResume ? 'resume' : 'new session'})`)
  const containerName = await createSession(gitRoot, branch, isResume, featuresPath, mode)
  console.log(`Container: ${containerName}`)

  // Read instructions template based on mode
  const templateName = mode === "plan" ? "ralph-plan-mode.md" : "ralph-instructions.md"
  const instructionsPath = `${RALPH_HOME}/templates/${templateName}`
  const instructions = await Bun.file(instructionsPath).text()

  // Start dashboard server if enabled
  if (dashboard) {
    const dashboardPath = `${RALPH_HOME}/dashboard/dist/index.html`
    startDashboardServer(dashboardPort, dashboardPath)
    setOnStopCallback(abortClaude)  // Wire up immediate stop
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
  let finalVerificationDone = false

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

      // Check remaining features (only in build mode)
      let remaining: { id: string }[] = []
      if (mode === "build") {
        const featuresJson = await Bun.$`docker exec -u node ${containerName} cat /workspace/${featuresPath}`.text()
        remaining = getRemainingFeatures(featuresJson)

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
          if (finalVerificationDone) {
            console.log("\n=== All features complete and verified! ===")
            // Mark PR as ready for review
            await Bun.$`docker exec -u node ${containerName} gh pr ready ${branch}`.quiet().nothrow()
            break
          }
          console.log("\n=== All features complete! Running final verification iteration... ===")
          finalVerificationDone = true
          // Continue to run Claude one more time for final verification
          // Claude will run typecheck, test, build and fix any issues
        }

        console.log(`${remaining.length} features remaining.`)
      } else {
        // Plan mode: just show iteration info
        if (dashboard) {
          updateIteration(iteration, 1, 0)  // Plan mode runs once
        }
        console.log("Running planning analysis...")
      }

      // Write prompt to container
      const promptPath = `/workspace/.ralph-prompt.md`
      await Bun.$`docker exec -u node ${containerName} bash -c ${`cat > ${promptPath} << 'PROMPT_EOF'
${instructions}
PROMPT_EOF`}`

      // Run Claude inside container
      if (dashboard) setClaudeRunning(true)
      claudeAbortController = new AbortController()
      const success = await runClaudeInContainer(
        containerName,
        `Read .ralph-prompt.md and follow the instructions.`,
        TIMEOUT_MS,
        dashboard,
        claudeAbortController.signal
      )
      claudeAbortController = null
      if (dashboard) setClaudeRunning(false)

      // Check for stop immediately after Claude finishes
      if (dashboard && isStopping()) {
        console.log("\n=== Stopped ===")
        break
      }

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
      // First check if remote branch exists
      const remoteBranchExists = await Bun.$`docker exec -u node ${containerName} git ls-remote --heads origin ${branch}`.text().catch(() => "")

      let hasUnpushed = false
      if (remoteBranchExists.trim()) {
        // Remote exists - check for unpushed commits
        const pushCheck = await Bun.$`docker exec -u node ${containerName} git log origin/${branch}..HEAD --oneline`.text().catch(() => "")
        hasUnpushed = hasUnpushedCommits(pushCheck)
      } else {
        // Remote doesn't exist - check if we have any local commits
        const localCommits = await Bun.$`docker exec -u node ${containerName} git log --oneline -1`.text().catch(() => "")
        hasUnpushed = localCommits.trim().length > 0
      }

      if (hasUnpushed) {
        console.log("WARNING: Unpushed commits detected - attempting to push...")
        // Use -u origin HEAD for new branches
        const pushResult = await Bun.$`docker exec -u node ${containerName} git push -u origin HEAD`.nothrow()
        if (pushResult.exitCode !== 0) {
          console.log("WARNING: Push failed - may need manual intervention")
          noChangeCount++
        } else {
          console.log("Push succeeded (orchestrator retry)")
          noChangeCount = 0
          // Reset final verification if Claude made changes during verification
          finalVerificationDone = false
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

      // Plan mode: Check if Claude created the PR and is done
      if (mode === "plan") {
        // Check if PR exists (Claude's signal that planning is complete)
        const prExists = await Bun.$`docker exec -u node ${containerName} gh pr view HEAD --json url`.text().catch(() => "")
        if (prExists.includes('"url"')) {
          // Check if Claude made any commits this iteration
          // If PR exists but no new commits, Claude is signaling completion
          if (!hasUnpushed) {
            console.log("\n=== Planning complete ===")
            break
          }
        }
        console.log("\n=== Planning iteration complete, continuing... ===")
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
