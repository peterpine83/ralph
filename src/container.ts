// Container lifecycle management utilities

export interface SessionConfig {
  gitRoot: string;
  branch: string;
  isResume: boolean;
  githubToken?: string;
  claudeOAuthToken?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  sshDir?: string;
  claudeDir?: string;
  gitconfigPath?: string;
}

export interface ContainerCommands {
  createArgs: string[];
  startArgs: string[];
  copyCommand: { tarCmd: string; execCmd: string };
  gitSetupCommands: string[][];
  gitCheckoutCommand: string[];
}

/**
 * Generate container name from session ID
 */
export function generateContainerName(sessionId?: string): string {
  const id = sessionId || `ralph-${Date.now()}`;
  return `ralph-session-${id}`;
}

/**
 * Generate docker create arguments for a new container
 */
export function buildDockerCreateArgs(containerName: string, config: SessionConfig): string[] {
  const args = [
    "docker", "create",
    "--name", containerName,
    "--cap-add=NET_ADMIN",
  ];

  // Volume mounts (read-only where possible)
  if (config.sshDir) {
    args.push("-v", `${config.sshDir}:/home/node/.ssh:ro`);
  }
  if (config.claudeDir) {
    args.push("-v", `${config.claudeDir}:/home/node/.claude:rw`);
  }
  if (config.gitconfigPath) {
    args.push("-v", `${config.gitconfigPath}:/home/node/.gitconfig:ro`);
  }

  // Environment variables
  if (config.claudeOAuthToken) {
    args.push("-e", `CLAUDE_CODE_OAUTH_TOKEN=${config.claudeOAuthToken}`);
  }
  if (config.githubToken) {
    args.push("-e", `GITHUB_TOKEN=${config.githubToken}`);
  }
  args.push("-e", `GIT_AUTHOR_NAME=${config.gitAuthorName || 'Ralph'}`);
  args.push("-e", `GIT_AUTHOR_EMAIL=${config.gitAuthorEmail || 'ralph@localhost'}`);

  // Working directory and image
  args.push("-w", "/workspace");
  args.push("ralph-base:latest");
  args.push("sleep", "infinity");

  return args;
}

/**
 * Generate the tar command for copying project into container
 */
export function buildCopyCommand(containerName: string, gitRoot: string): { tarCmd: string; execCmd: string } {
  return {
    tarCmd: `tar -C ${gitRoot} -cf - .`,
    execCmd: `docker exec -i ${containerName} tar -xf - -C /workspace`,
  };
}

/**
 * Generate git checkout command based on resume mode
 */
export function buildGitCheckoutCommand(containerName: string, branch: string, isResume: boolean): string[][] {
  if (isResume) {
    return [
      ["docker", "exec", containerName, "git", "fetch", "origin", branch],
      ["docker", "exec", containerName, "git", "checkout", "-B", branch, `origin/${branch}`],
    ];
  }
  return [
    ["docker", "exec", containerName, "git", "checkout", "-b", branch],
  ];
}

/**
 * Parse stale container names from docker ps output
 */
export function parseStaleContainers(dockerPsOutput: string): string[] {
  return dockerPsOutput.trim().split('\n').filter(Boolean);
}

/**
 * Parse container running state from docker inspect output
 */
export function parseContainerRunning(inspectOutput: string): boolean {
  return inspectOutput.trim() === "true";
}

/**
 * Parse features JSON and extract remaining features
 */
export function getRemainingFeatures(featuresJson: string): Array<{ id: string; passes: boolean }> {
  const parsed = JSON.parse(featuresJson);
  return parsed.features.filter((f: { passes: boolean }) => !f.passes);
}

/**
 * Parse git log output to check for unpushed commits
 */
export function hasUnpushedCommits(gitLogOutput: string): boolean {
  return gitLogOutput.trim().length > 0;
}
