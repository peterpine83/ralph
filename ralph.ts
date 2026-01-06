#!/usr/bin/env bun
// Ralph Orchestrator - Simple loop, Claude picks features
// Per Anthropic best practices: simple loop, file-based state, no JSON output

import { parseArgs } from "./src/args";
import {
  generateContainerName,
  buildDockerCreateArgs,
  buildCopyCommand,
  buildGitCheckoutCommand,
  parseStaleContainers,
  parseContainerRunning,
  getRemainingFeatures,
  hasUnpushedCommits,
  type SessionConfig,
} from "./src/container";

const TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes per iteration
const MAX_NO_CHANGE = 3;            // Circuit breaker: 3 iterations with no git diff

// IMPORTANT: This script must be run from ~/ralph/ directory
// The templates are resolved relative to this script's location
const RALPH_HOME = import.meta.dir;

// === Cleanup and Error Handling ===

async function cleanupStaleContainers(): Promise<void> {
  const stale = await Bun.$`docker ps -a --filter name=ralph-session --format "{{.Names}}"`.text();
  for (const name of parseStaleContainers(stale)) {
    console.log(`Cleaning up stale container: ${name}`);
    await Bun.$`docker rm -f ${name}`.quiet().nothrow();
  }
}

async function ensureContainerRunning(containerName: string): Promise<boolean> {
  const isRunning = await Bun.$`docker inspect -f '{{.State.Running}}' ${containerName}`.text().catch(() => "false");
  if (!parseContainerRunning(isRunning)) {
    console.log("Container stopped unexpectedly, restarting...");
    const result = await Bun.$`docker start ${containerName}`.nothrow();
    return result.exitCode === 0;
  }
  return true;
}

// === Container Lifecycle Management ===

async function createSession(gitRoot: string, branch: string, isResume: boolean): Promise<string> {
  const containerName = generateContainerName();

  // Get GitHub token for private repo access (needed for resume/push)
  const githubToken = process.env.GITHUB_TOKEN ||
    await Bun.$`gh auth token`.text().catch(() => "");

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
    sleep infinity`;

  // Start container (runs entrypoint with firewall init)
  await Bun.$`docker start ${containerName}`;

  // Wait for entrypoint to complete (firewall init + git setup)
  // The entrypoint prints "=== Ralph Firewall Ready ===" when done
  console.log("Waiting for container initialization...");
  for (let i = 0; i < 30; i++) {
    const logs = await Bun.$`docker logs ${containerName} 2>&1`.text();
    if (logs.includes("Ralph Firewall Ready")) break;
    await Bun.sleep(1000);
  }

  // Copy project into container
  console.log("Copying project into container...");
  await Bun.$`tar -C ${gitRoot} -cf - . | docker exec -i ${containerName} tar -xf - -C /workspace`;

  // Fix git ownership issues (files copied as root, git runs as node)
  await Bun.$`docker exec ${containerName} git config --global --add safe.directory /workspace`;

  // Ensure git credential helper is configured (in case entrypoint didn't run it)
  if (githubToken.trim()) {
    await Bun.$`docker exec ${containerName} git config --system credential.helper '!gh auth git-credential'`;
  }

  if (isResume) {
    // Fetch and checkout existing branch from remote
    console.log(`Resuming branch: ${branch}`);
    await Bun.$`docker exec ${containerName} git fetch origin ${branch}`;
    await Bun.$`docker exec ${containerName} git checkout -B ${branch} origin/${branch}`;
  } else {
    // Create new branch
    await Bun.$`docker exec ${containerName} git checkout -b ${branch}`;
  }

  return containerName;
}

async function cleanupSession(containerName: string): Promise<void> {
  console.log(`Cleaning up container: ${containerName}`);
  await Bun.$`docker rm -f ${containerName}`.quiet().nothrow();
}

async function runClaudeInContainer(containerName: string, prompt: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const proc = Bun.spawn([
      "docker", "exec", containerName,
      "claude", "-p", "--dangerously-skip-permissions", prompt
    ], { signal: controller.signal, stdout: "inherit", stderr: "inherit" });

    await proc.exited;
    return true;
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.log("TIMEOUT: Claude killed after timeout");
      return false;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// Helper: append to progress log (orchestrator-side logging)
async function log(gitRoot: string, message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(line.trim());
  // Note: Claude also writes to ralph-progress.txt, orchestrator logs to console
}

async function main() {
  const { featuresPath, branch: resumeBranch, once, maxIterations } = parseArgs(process.argv.slice(2));

  // Cleanup any stale containers from previous sessions
  await cleanupStaleContainers();

  // Validate environment
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.error("ERROR: CLAUDE_CODE_OAUTH_TOKEN not set");
    process.exit(1);
  }

  // Find git root (still needed for initial copy)
  const gitRoot = (await Bun.$`git rev-parse --show-toplevel`.text()).trim();
  if (!gitRoot) {
    console.error("ERROR: Not in a git repository");
    process.exit(1);
  }

  // Verify features.json exists
  const featuresFile = Bun.file(`${gitRoot}/${featuresPath}`);
  if (!await featuresFile.exists()) {
    console.error(`ERROR: Features file not found: ${featuresPath}`);
    process.exit(1);
  }

  // Determine branch name and detect resume mode
  const branch = resumeBranch || `ralph/${Date.now()}`;
  let isResume = false;

  if (resumeBranch) {
    // Check if branch exists on remote
    const remoteBranch = await Bun.$`git ls-remote --heads origin ${resumeBranch}`.text();
    if (remoteBranch.trim()) {
      isResume = true;
      console.log(`Found existing branch on remote: ${resumeBranch}`);
    } else {
      console.error(`ERROR: Branch not found on remote: ${resumeBranch}`);
      process.exit(1);
    }
  }

  // Create and start container (runs firewall init ONCE)
  console.log(`\n=== Starting Ralph Session ===`);
  console.log(`Branch: ${branch}`);
  console.log(`Mode: ${isResume ? 'Resume' : 'New session'}`);
  const containerName = await createSession(gitRoot, branch, isResume);
  console.log(`Container: ${containerName}`);

  // Read instructions template
  const instructionsPath = `${RALPH_HOME}/templates/ralph-instructions.md`;
  const instructions = await Bun.file(instructionsPath).text();

  let iteration = 0;
  let noChangeCount = 0;

  try {
    // Main loop
    while (true) {
      iteration++;

      if (iteration > maxIterations) {
        console.log(`\n=== Max iterations reached (${maxIterations}) ===`);
        break;
      }

      console.log(`\n=== Iteration ${iteration}/${maxIterations} ===`);

      // Verify container is still running before proceeding
      if (!await ensureContainerRunning(containerName)) {
        console.log("ERROR: Failed to restart container, aborting session");
        break;
      }

      // Check remaining features (read from container)
      const featuresJson = await Bun.$`docker exec ${containerName} cat /workspace/${featuresPath}`.text();
      const remaining = getRemainingFeatures(featuresJson);

      if (remaining.length === 0) {
        console.log("\n=== All features complete! ===");
        // Mark PR as ready for review
        await Bun.$`docker exec ${containerName} gh pr ready ${branch}`.quiet().nothrow();
        break;
      }

      console.log(`${remaining.length} features remaining.`);

      // Write prompt to container
      const promptPath = `/workspace/.ralph-prompt.md`;
      await Bun.$`docker exec ${containerName} bash -c ${`cat > ${promptPath} << 'PROMPT_EOF'
${instructions}
PROMPT_EOF`}`;

      // Run Claude inside container
      const success = await runClaudeInContainer(
        containerName,
        `Read .ralph-prompt.md and follow the instructions.`,
        TIMEOUT_MS
      );

      if (!success) {
        noChangeCount++;
        if (noChangeCount >= MAX_NO_CHANGE) {
          console.log("CIRCUIT BREAKER: No progress after timeouts");
          process.stdout.write("\x07");
          break;
        }
        continue;
      }

      // Check if Claude pushed (verify via git log)
      const pushCheck = await Bun.$`docker exec ${containerName} git log origin/${branch}..HEAD --oneline`.text().catch(() => "");
      if (hasUnpushedCommits(pushCheck)) {
        console.log("WARNING: Unpushed commits detected - attempting to push...");
        const pushResult = await Bun.$`docker exec ${containerName} git push`.nothrow();
        if (pushResult.exitCode !== 0) {
          console.log("WARNING: Push failed - may need manual intervention");
          noChangeCount++;
        } else {
          console.log("Push succeeded (orchestrator retry)");
          noChangeCount = 0;
        }
      } else {
        noChangeCount = 0;
      }

      if (once) {
        console.log("\n=== Single iteration complete (--once flag) ===");
        break;
      }
    }
  } finally {
    // Always cleanup container
    await cleanupSession(containerName);
  }

  console.log(`\nTo view PR: gh pr view ${branch}`);
}

main().catch(console.error);
