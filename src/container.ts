// Container lifecycle management utilities

export interface SessionConfig {
  gitRoot: string
  branch: string
  isResume: boolean
  githubToken?: string
  claudeOAuthToken?: string
  gitAuthorName?: string
  gitAuthorEmail?: string
  sshDir?: string
  claudeDir?: string
  gitconfigPath?: string
}

/**
 * Generate container name from session ID
 */
export function generateContainerName(sessionId?: string): string {
  const id = sessionId || `ralph-${Date.now()}`
  return `ralph-session-${id}`
}

/**
 * Parse stale container names from docker ps output
 */
export function parseStaleContainers(dockerPsOutput: string): string[] {
  return dockerPsOutput.trim().split('\n').filter(Boolean)
}

/**
 * Parse container running state from docker inspect output
 */
export function parseContainerRunning(inspectOutput: string): boolean {
  return inspectOutput.trim() === "true"
}

/**
 * Parse features JSON and extract remaining features
 */
export function getRemainingFeatures(featuresJson: string): Array<{ id: string; passes: boolean }> {
  const parsed = JSON.parse(featuresJson)
  return parsed.features.filter((f: { passes: boolean }) => !f.passes)
}

/**
 * Parse git log output to check for unpushed commits
 */
export function hasUnpushedCommits(gitLogOutput: string): boolean {
  return gitLogOutput.trim().length > 0
}
