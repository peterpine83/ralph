# Ralph Phase 1: ZFC + Validation Pipeline Implementation Plan

## Overview

Transform Ralph from a heuristic-based orchestrator to a **Zero Framework Cognition (ZFC)** compliant system with adversarial validation. Replace all hardcoded decisions with AI evaluation using Claude Code CLI, and add a 3-layer validation pipeline before accepting feature completions.

**Key Constraint**: Uses Claude Code CLI (`claude -p`) for AI evaluations, not the Anthropic SDK. This maintains compatibility with the Claude Code Mac subscription and existing OAuth token authentication.

## Current State Analysis

### Existing Architecture
- `ralph.ts` (287 lines) - Main orchestrator loop
- `src/container.ts` (124 lines) - Docker command generation (pure functions)
- `src/args.ts` (31 lines) - CLI argument parsing
- `templates/ralph-instructions.md` - Claude agent instructions
- Docker container with network firewall (iptables whitelist)

### ZFC Violations to Fix

| Location | Code | Violation | Replacement |
|----------|------|-----------|-------------|
| `ralph.ts:19` | `MAX_NO_CHANGE = 3` | Hardcoded policy | `assessSessionProgress()` |
| `ralph.ts:247-254` | Circuit breaker logic | Heuristic decision | AI evaluation |
| `container.ts:113-116` | `!f.passes` filter | Boolean heuristic | `evaluateFeatureStatus()` |
| `container.ts:121-123` | `gitLogOutput.trim().length > 0` | String length check | `decidePushStatus()` |
| `ralph.ts:247` | Timeout = failure | Heuristic assumption | `analyzeTimeout()` |

### Current Validation Gap
- Claude marks `passes: true` without adversarial verification
- Orchestrator trusts Claude's claims blindly
- No structural or semantic review before accepting

## Desired End State

After implementation:

1. **All cognitive decisions delegated to AI** - No hardcoded heuristics for session progress, feature status, or error handling
2. **3-layer validation pipeline** - Every feature completion verified before acceptance
3. **Validation toggle** - Validation can be disabled for quick iterations, but ZFC is always on
4. **Observability** - ZFC evaluation metrics logged for debugging

### Verification Commands
```bash
# All tests pass
bun test

# Type checking passes (when added)
bun run typecheck

# ZFC evaluator unit tests pass
bun test src/zfc/

# Validation pipeline tests pass
bun test src/validation/
```

## What We're NOT Doing

- **Beads integration** - Stays with features.json for now (Phase 2)
- **Multi-worker parallelism** - Single worker only (Phase 3)
- **SDK direct API calls** - Uses Claude Code CLI, not `@anthropic-ai/sdk`
- **Model routing** - Not implemented (add later if switching to API billing)
- **Layer 4 CI integration** - Only Layers 1-3 in this phase
- **Web dashboard** - Console-only observability
- **ZFC toggle** - ZFC is always on; it's the architecture, not a feature

## Implementation Approach

Use Claude Code CLI for all AI evaluations. The evaluator invokes `claude -p` with structured prompts requesting JSON output, then parses the response.

```typescript
// Pattern for all ZFC evaluations
async function evaluate<T>(prompt: string, containerName: string): Promise<T> {
  const result = await Bun.$`docker exec -u node ${containerName} claude -p ${prompt}`.text()
  return parseJsonFromResponse<T>(result)
}
```

---

## Phase 1a: ZFC Core Infrastructure

### Overview
Create the `src/zfc/` module with the AIEvaluator interface and Claude Code CLI implementation.

### Changes Required

#### 1. Create ZFC Module Structure
**Directory**: `src/zfc/`

Create the following files:
- `src/zfc/evaluator.ts` - Interface definitions
- `src/zfc/claude-evaluator.ts` - Claude Code CLI implementation
- `src/zfc/prompts.ts` - Prompt template functions
- `src/zfc/types.ts` - Response type definitions
- `src/zfc/index.ts` - Module exports

#### 2. Define AIEvaluator Interface
**File**: `src/zfc/evaluator.ts`

```typescript
import type {
  FeatureAssessment,
  ProgressAssessment,
  TimeoutAnalysis,
  PushDecision,
  WorkspaceState,
  SessionState,
  ContainerState,
  GitState,
} from "./types"

export interface AIEvaluator {
  /**
   * Evaluate which features still need work
   * Replaces: getRemainingFeatures() boolean filter
   */
  evaluateFeatureStatus(
    featuresJson: string,
    workspaceState: WorkspaceState
  ): Promise<FeatureAssessment[]>

  /**
   * Assess whether the session is making progress
   * Replaces: noChangeCount >= MAX_NO_CHANGE
   */
  assessSessionProgress(
    iterationHistory: IterationResult[],
    currentState: SessionState
  ): Promise<ProgressAssessment>

  /**
   * Analyze what happened during a timeout
   * Replaces: timeout = failure assumption
   */
  analyzeTimeout(
    containerState: ContainerState,
    lastKnownProgress: string
  ): Promise<TimeoutAnalysis>

  /**
   * Decide if there are unpushed commits worth pushing
   * Replaces: hasUnpushedCommits() string length check
   */
  decidePushStatus(gitState: GitState): Promise<PushDecision>
}

export interface IterationResult {
  iteration: number
  duration: number
  outcome: "success" | "timeout" | "error"
  gitChanges: boolean
  featuresCompleted: number
  error?: string
}
```

#### 3. Define Response Types
**File**: `src/zfc/types.ts`

```typescript
export interface FeatureAssessment {
  featureId: string
  status: "complete" | "in_progress" | "blocked" | "not_started"
  confidence: number // 0.0 to 1.0
  reasoning: string
  blockedBy?: string[]
}

export interface ProgressAssessment {
  decision: "continue" | "pause" | "stuck" | "abort"
  reasoning: string
  suggestedAction?: string
  stuckReason?: string
}

export interface TimeoutAnalysis {
  madeProgress: boolean
  progressDescription?: string
  recommendation: "resume" | "retry" | "skip" | "abort"
  reasoning: string
}

export interface PushDecision {
  shouldPush: boolean
  reasoning: string
  unpushedCommits: number
  commitSummary?: string
}

export interface WorkspaceState {
  modifiedFiles: string[]
  lastCommitMessage: string
  testStatus: "passing" | "failing" | "unknown"
  branch: string
}

export interface SessionState {
  totalIterations: number
  featuresRemaining: number
  noChangeStreak: number
  lastError?: string
}

export interface ContainerState {
  processes: string
  lastModified: string
  gitStatus: string
}

export interface GitState {
  gitLogOutput: string
  gitStatusOutput: string
  branch: string
}
```

#### 4. Create Prompt Templates
**File**: `src/zfc/prompts.ts`

```typescript
import type { WorkspaceState, SessionState, ContainerState, GitState, IterationResult } from "./types"

export function featureStatusPrompt(featuresJson: string, workspaceState: WorkspaceState): string {
  return `You are evaluating completion status for features in a software project.

## Features Definition
\`\`\`json
${featuresJson}
\`\`\`

## Current Workspace State
- Branch: ${workspaceState.branch}
- Modified files: ${workspaceState.modifiedFiles.join(", ") || "none"}
- Last commit: ${workspaceState.lastCommitMessage}
- Test status: ${workspaceState.testStatus}

## Task
For each feature, assess:
1. Is it complete, in progress, blocked, or not started?
2. How confident are you (0.0-1.0)?
3. Brief reasoning (one sentence)

Consider the verification command for each feature - has it been satisfied?

Respond with ONLY a JSON array, no other text:
\`\`\`json
[
  {
    "featureId": "...",
    "status": "complete|in_progress|blocked|not_started",
    "confidence": 0.0-1.0,
    "reasoning": "..."
  }
]
\`\`\``
}

export function sessionProgressPrompt(
  iterationHistory: IterationResult[],
  currentState: SessionState
): string {
  const historyText = iterationHistory
    .slice(-10) // Last 10 iterations
    .map(
      (r, i) => `Iteration ${r.iteration}:
  - Duration: ${r.duration}ms
  - Outcome: ${r.outcome}
  - Git changes: ${r.gitChanges}
  - Features completed: ${r.featuresCompleted}
  - Error: ${r.error || "none"}`
    )
    .join("\n\n")

  return `You are a session supervisor deciding whether an AI coding session should continue.

## Iteration History (last ${Math.min(iterationHistory.length, 10)} iterations)
${historyText}

## Current State
- Total iterations: ${currentState.totalIterations}
- Features remaining: ${currentState.featuresRemaining}
- Consecutive no-change iterations: ${currentState.noChangeStreak}
- Last error: ${currentState.lastError || "none"}

## Decision Options
- **continue**: Progress is being made, keep iterating
- **pause**: Temporary issue (rate limit, transient error), wait and retry
- **stuck**: No progress despite attempts, needs different approach or human help
- **abort**: Fundamental issue, stop session

## Analysis Guidelines
1. Look at TRENDS, not just the last iteration
2. "No git changes" doesn't mean no progress (could be debugging, reading code)
3. Same error repeating 3+ times = likely stuck
4. Consider complexity: some features take multiple iterations

Respond with ONLY JSON, no other text:
\`\`\`json
{
  "decision": "continue|pause|stuck|abort",
  "reasoning": "...",
  "suggestedAction": "..."
}
\`\`\``
}

export function timeoutAnalysisPrompt(
  containerState: ContainerState,
  lastKnownProgress: string
): string {
  return `A Claude session was killed after timeout. Analyze whether progress was made.

## Container State at Timeout
- Running processes: ${containerState.processes}
- Last file modified: ${containerState.lastModified}
- Git status: ${containerState.gitStatus}

## Progress Log Tail
\`\`\`
${lastKnownProgress}
\`\`\`

## Questions to Answer
1. Did Claude make meaningful progress before timeout?
2. Should we resume from here, retry fresh, skip this feature, or abort?

Respond with ONLY JSON, no other text:
\`\`\`json
{
  "madeProgress": true|false,
  "progressDescription": "...",
  "recommendation": "resume|retry|skip|abort",
  "reasoning": "..."
}
\`\`\``
}

export function pushDecisionPrompt(gitState: GitState): string {
  return `Analyze git state to determine if there are commits worth pushing.

## Git Log (unpushed commits)
\`\`\`
${gitState.gitLogOutput}
\`\`\`

## Git Status
\`\`\`
${gitState.gitStatusOutput}
\`\`\`

## Branch
${gitState.branch}

## Task
Determine if there are meaningful commits that should be pushed.
Consider: Are these real feature commits or just noise?

Respond with ONLY JSON, no other text:
\`\`\`json
{
  "shouldPush": true|false,
  "reasoning": "...",
  "unpushedCommits": <number>,
  "commitSummary": "..."
}
\`\`\``
}
```

#### 5. Implement ClaudeEvaluator
**File**: `src/zfc/claude-evaluator.ts`

```typescript
import type { AIEvaluator, IterationResult } from "./evaluator"
import type {
  FeatureAssessment,
  ProgressAssessment,
  TimeoutAnalysis,
  PushDecision,
  WorkspaceState,
  SessionState,
  ContainerState,
  GitState,
} from "./types"
import {
  featureStatusPrompt,
  sessionProgressPrompt,
  timeoutAnalysisPrompt,
  pushDecisionPrompt,
} from "./prompts"

export interface ClaudeEvaluatorConfig {
  containerName: string
  verbose?: boolean
}

export class ClaudeEvaluator implements AIEvaluator {
  private containerName: string
  private verbose: boolean

  constructor(config: ClaudeEvaluatorConfig) {
    this.containerName = config.containerName
    this.verbose = config.verbose ?? false
  }

  private async callClaude(prompt: string): Promise<string> {
    if (this.verbose) {
      console.log("[ZFC] Calling Claude for evaluation...")
    }

    const result = await Bun.$`docker exec -u node ${this.containerName} claude -p ${prompt}`
      .text()
      .catch((e) => {
        console.error("[ZFC] Claude call failed:", e.message)
        throw e
      })

    if (this.verbose) {
      console.log("[ZFC] Claude response received")
    }

    return result
  }

  private parseJsonFromResponse<T>(response: string): T {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim()

    try {
      return JSON.parse(jsonStr) as T
    } catch (e) {
      console.error("[ZFC] Failed to parse JSON response:", jsonStr)
      throw new Error(`Failed to parse ZFC response: ${e}`)
    }
  }

  async evaluateFeatureStatus(
    featuresJson: string,
    workspaceState: WorkspaceState
  ): Promise<FeatureAssessment[]> {
    const prompt = featureStatusPrompt(featuresJson, workspaceState)
    const response = await this.callClaude(prompt)
    return this.parseJsonFromResponse<FeatureAssessment[]>(response)
  }

  async assessSessionProgress(
    iterationHistory: IterationResult[],
    currentState: SessionState
  ): Promise<ProgressAssessment> {
    const prompt = sessionProgressPrompt(iterationHistory, currentState)
    const response = await this.callClaude(prompt)
    return this.parseJsonFromResponse<ProgressAssessment>(response)
  }

  async analyzeTimeout(
    containerState: ContainerState,
    lastKnownProgress: string
  ): Promise<TimeoutAnalysis> {
    const prompt = timeoutAnalysisPrompt(containerState, lastKnownProgress)
    const response = await this.callClaude(prompt)
    return this.parseJsonFromResponse<TimeoutAnalysis>(response)
  }

  async decidePushStatus(gitState: GitState): Promise<PushDecision> {
    const prompt = pushDecisionPrompt(gitState)
    const response = await this.callClaude(prompt)
    return this.parseJsonFromResponse<PushDecision>(response)
  }
}
```

#### 6. Create Module Index
**File**: `src/zfc/index.ts`

```typescript
export * from "./evaluator"
export * from "./types"
export * from "./claude-evaluator"
```

### Success Criteria

#### Automated Verification:
- [ ] All ZFC module files exist in `src/zfc/`
- [ ] Unit tests pass: `bun test src/zfc/`
- [ ] Types compile without errors
- [ ] ClaudeEvaluator can parse sample JSON responses

#### Manual Verification:
- [ ] ClaudeEvaluator successfully calls Claude Code CLI in a test container
- [ ] JSON parsing handles various response formats (with/without code blocks)

**Implementation Note**: After completing this phase, run `bun test src/zfc/` to verify unit tests pass before proceeding to Phase 1b.

---

## Phase 1b: Replace ZFC Violations in ralph.ts

### Overview
Replace all hardcoded heuristics in ralph.ts with calls to the ZFC evaluator.

### Changes Required

#### 1. Add Configuration Types
**File**: `src/config.ts` (new file)

```typescript
export interface RalphConfig {
  verbose: boolean
  validation: {
    enabled: boolean
    layers: (1 | 2 | 3)[]
  }
}

export const DEFAULT_CONFIG: RalphConfig = {
  verbose: false,
  validation: {
    enabled: true, // Validation on by default
    layers: [1, 2, 3],
  },
}

export function loadConfig(): RalphConfig {
  // Future: load from ralph.config.ts if present
  // For now, return defaults with env overrides
  return {
    verbose: process.env.RALPH_VERBOSE === "true",
    validation: {
      enabled: process.env.RALPH_VALIDATION_ENABLED !== "false",
      layers: [1, 2, 3],
    },
  }
}
```

**Note**: ZFC is not configurable - it's the architecture. The `verbose` flag controls logging for both ZFC evaluations and validation.

#### 2. Add State Helpers
**File**: `src/state.ts` (new file)

```typescript
import type { WorkspaceState, SessionState, ContainerState, GitState } from "./zfc/types"

export async function getWorkspaceState(
  containerName: string,
  branch: string
): Promise<WorkspaceState> {
  const modifiedFiles = await Bun.$`docker exec -u node ${containerName} git diff --name-only`
    .text()
    .then((s) => s.trim().split("\n").filter(Boolean))
    .catch(() => [])

  const lastCommitMessage = await Bun.$`docker exec -u node ${containerName} git log -1 --format=%s`
    .text()
    .then((s) => s.trim())
    .catch(() => "unknown")

  // Try to determine test status
  let testStatus: "passing" | "failing" | "unknown" = "unknown"
  // Could run quick test check here if needed

  return {
    modifiedFiles,
    lastCommitMessage,
    testStatus,
    branch,
  }
}

export async function getContainerState(containerName: string): Promise<ContainerState> {
  const processes = await Bun.$`docker exec ${containerName} ps aux`
    .text()
    .catch(() => "unknown")

  const lastModified = await Bun.$`docker exec -u node ${containerName} find /workspace -type f -mmin -5 -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -5`
    .text()
    .catch(() => "unknown")

  const gitStatus = await Bun.$`docker exec -u node ${containerName} git status --short`
    .text()
    .catch(() => "unknown")

  return { processes, lastModified, gitStatus }
}

export async function getGitState(containerName: string, branch: string): Promise<GitState> {
  const gitLogOutput = await Bun.$`docker exec -u node ${containerName} git log origin/${branch}..HEAD --oneline`
    .text()
    .catch(() => "")

  const gitStatusOutput = await Bun.$`docker exec -u node ${containerName} git status --short`
    .text()
    .catch(() => "")

  return { gitLogOutput, gitStatusOutput, branch }
}
```

#### 3. Update ralph.ts Main Loop

**File**: `ralph.ts`

Key changes to make:

1. **Remove hardcoded constants**:
```typescript
// REMOVE these lines
const TIMEOUT_MS = 5 * 60 * 1000
const MAX_NO_CHANGE = 3

// REPLACE with
import { loadConfig } from "./src/config"
const config = loadConfig()
const TIMEOUT_MS = 5 * 60 * 1000 // Keep timeout, it's not a cognitive decision
// MAX_NO_CHANGE is removed entirely - ZFC handles this
```

2. **Add ZFC evaluator initialization after container creation**:
```typescript
import { ClaudeEvaluator } from "./src/zfc"
import { getWorkspaceState, getContainerState, getGitState } from "./src/state"
import type { IterationResult } from "./src/zfc"

// After createSession()
const evaluator = new ClaudeEvaluator({ containerName, verbose: config.verbose })
const iterationHistory: IterationResult[] = []
```

3. **Replace getRemainingFeatures() call** (around line 222-224):
```typescript
// BEFORE
const featuresJson = await Bun.$`docker exec -u node ${containerName} cat /workspace/${featuresPath}`.text()
const remaining = getRemainingFeatures(featuresJson)

// AFTER
const featuresJson = await Bun.$`docker exec -u node ${containerName} cat /workspace/${featuresPath}`.text()
const workspaceState = await getWorkspaceState(containerName, branch)
const assessments = await evaluator.evaluateFeatureStatus(featuresJson, workspaceState)
const remaining = assessments
  .filter((a) => a.status !== "complete")
  .map((a) => ({ id: a.featureId }))

if (config.verbose) {
  console.log("[ZFC] Feature assessments:", assessments)
}
```

**Note**: No fallback - ZFC is always used. The old `getRemainingFeatures()` function can be removed from `src/container.ts`.

4. **Replace circuit breaker logic** (around line 247-254):
```typescript
// BEFORE
if (!success) {
  noChangeCount++
  if (noChangeCount >= MAX_NO_CHANGE) {
    console.log("CIRCUIT BREAKER: No progress after timeouts")
    process.stdout.write("\x07")
    break
  }
  continue
}

// AFTER
if (!success) {
  // Record iteration result
  iterationHistory.push({
    iteration,
    duration: TIMEOUT_MS,
    outcome: "timeout",
    gitChanges: false,
    featuresCompleted: 0,
  })

  // ZFC: Ask AI to analyze the timeout
  const containerState = await getContainerState(containerName)
  const progressLog = await Bun.$`docker exec -u node ${containerName} tail -50 /workspace/ralph-progress.txt`
    .text()
    .catch(() => "")
  const analysis = await evaluator.analyzeTimeout(containerState, progressLog)

  console.log(`[ZFC] Timeout analysis: ${analysis.recommendation} - ${analysis.reasoning}`)

  if (analysis.recommendation === "abort") {
    console.log("CIRCUIT BREAKER (ZFC): Session should abort")
    process.stdout.write("\x07")
    break
  } else if (analysis.recommendation === "skip") {
    console.log("[ZFC] Skipping current feature, will try another")
  }
  // resume or retry: continue normally
  continue
}
```

**Note**: No fallback - the old `noChangeCount` logic is completely removed.

5. **Replace hasUnpushedCommits() check** (around line 258-271):
```typescript
// BEFORE
const pushCheck = await Bun.$`docker exec -u node ${containerName} git log origin/${branch}..HEAD --oneline`.text().catch(() => "")
if (hasUnpushedCommits(pushCheck)) {
  // ...push logic
}

// AFTER
const gitState = await getGitState(containerName, branch)
const pushDecision = await evaluator.decidePushStatus(gitState)

if (config.verbose) {
  console.log(`[ZFC] Push decision: ${pushDecision.shouldPush} - ${pushDecision.reasoning}`)
}

if (pushDecision.shouldPush) {
  console.log("Pushing commits...")
  const pushResult = await Bun.$`docker exec -u node ${containerName} git push`.nothrow()
  // ... rest of push logic
}
```

**Note**: No fallback - the old `hasUnpushedCommits()` function can be removed from `src/container.ts`.

6. **Add session progress check at end of each iteration**:
```typescript
// After successful iteration, before loop continues
iterationHistory.push({
  iteration,
  duration: Date.now() - iterationStart,
  outcome: "success",
  gitChanges: pushDecision.shouldPush,
  featuresCompleted: previousRemaining - remaining.length,
})

if (iteration > 1) {
  const sessionState: SessionState = {
    totalIterations: iteration,
    featuresRemaining: remaining.length,
    noChangeStreak: 0, // ZFC tracks this via iterationHistory
  }

  const progress = await evaluator.assessSessionProgress(iterationHistory, sessionState)

  if (progress.decision === "abort") {
    console.log(`[ZFC] Session abort: ${progress.reasoning}`)
    break
  } else if (progress.decision === "stuck") {
    console.log(`[ZFC] Session stuck: ${progress.reasoning}`)
    console.log(`[ZFC] Suggestion: ${progress.suggestedAction}`)
    // Could implement suggestion handling here
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] `bun test` passes (including new ZFC integration tests)
- [ ] Ralph runs successfully end-to-end
- [ ] Old heuristic functions removed from `src/container.ts`

#### Manual Verification:
- [ ] Run Ralph on a test project, verify AI evaluations appear in logs with `RALPH_VERBOSE=true`
- [ ] Verify ZFC decisions are more nuanced than the old hardcoded thresholds
- [ ] Confirm circuit breaker triggers appropriately on stuck sessions

**Implementation Note**: There is no fallback mode - ZFC is the architecture. Test thoroughly before proceeding to Phase 1c.

---

## Phase 1c: Validation Pipeline (Layers 1-3)

### Overview
Add a 3-layer validation pipeline that verifies feature completions before accepting them.

### Changes Required

#### 1. Create Validation Module Structure
**Directory**: `src/validation/`

- `src/validation/pipeline.ts` - Main validation orchestrator
- `src/validation/layer1.ts` - Automated checks
- `src/validation/layer2.ts` - Structural checks
- `src/validation/layer3.ts` - Semantic validator (AI)
- `src/validation/types.ts` - Validation result types
- `src/validation/index.ts` - Module exports

#### 2. Define Validation Types
**File**: `src/validation/types.ts`

```typescript
export interface ValidationResult {
  layer: 1 | 2 | 3
  passed: boolean
  issues: ValidationIssue[]
  duration: number
}

export interface ValidationIssue {
  severity: "critical" | "warning" | "info"
  category: string
  title: string
  description: string
  file?: string
  line?: number
}

export interface ValidationReport {
  featureId: string
  timestamp: Date
  layers: ValidationResult[]
  overallVerdict: "APPROVED" | "NEEDS_WORK"
  summary: string
}

export interface Layer2Config {
  maxDiffLines: number
  secretPatterns: string[]
  debugPatterns: string[]
}

export const DEFAULT_LAYER2_CONFIG: Layer2Config = {
  maxDiffLines: 500,
  secretPatterns: [
    "password\\s*=",
    "api_key\\s*=",
    "secret\\s*=",
    "token\\s*=",
    "-----BEGIN.*PRIVATE KEY-----",
  ],
  debugPatterns: [
    "console\\.log\\(",
    "debugger;",
    "TODO:",
    "FIXME:",
    "XXX:",
  ],
}
```

#### 3. Implement Layer 1: Automated Checks
**File**: `src/validation/layer1.ts`

```typescript
import type { ValidationResult, ValidationIssue } from "./types"

export interface Layer1Options {
  containerName: string
  featureId: string
  verificationCommand: string
  workspacePath: string
}

export async function runLayer1(options: Layer1Options): Promise<ValidationResult> {
  const startTime = Date.now()
  const issues: ValidationIssue[] = []

  // 1. Run feature's verification command
  const verifyResult = await Bun.$`docker exec -u node ${options.containerName} bash -c ${options.verificationCommand}`
    .nothrow()
    .quiet()

  if (verifyResult.exitCode !== 0) {
    issues.push({
      severity: "critical",
      category: "verification",
      title: "Verification command failed",
      description: `Exit code ${verifyResult.exitCode}: ${verifyResult.stderr.toString()}`,
    })
  }

  // 2. Run type check if available
  const typeCheckResult = await Bun.$`docker exec -u node ${options.containerName} bash -c "cd ${options.workspacePath} && (npm run typecheck 2>/dev/null || pnpm typecheck 2>/dev/null || bun run typecheck 2>/dev/null || echo 'no-typecheck')"`
    .nothrow()
    .quiet()

  if (typeCheckResult.exitCode !== 0 && !typeCheckResult.stdout.toString().includes("no-typecheck")) {
    issues.push({
      severity: "critical",
      category: "typecheck",
      title: "Type checking failed",
      description: typeCheckResult.stderr.toString().slice(0, 500),
    })
  }

  // 3. Run linting if available
  const lintResult = await Bun.$`docker exec -u node ${options.containerName} bash -c "cd ${options.workspacePath} && (npm run lint 2>/dev/null || pnpm lint 2>/dev/null || bun run lint 2>/dev/null || echo 'no-lint')"`
    .nothrow()
    .quiet()

  if (lintResult.exitCode !== 0 && !lintResult.stdout.toString().includes("no-lint")) {
    issues.push({
      severity: "warning",
      category: "lint",
      title: "Linting issues found",
      description: lintResult.stderr.toString().slice(0, 500),
    })
  }

  // 4. Run tests if available
  const testResult = await Bun.$`docker exec -u node ${options.containerName} bash -c "cd ${options.workspacePath} && (npm test 2>/dev/null || pnpm test 2>/dev/null || bun test 2>/dev/null || echo 'no-tests')"`
    .nothrow()
    .quiet()

  if (testResult.exitCode !== 0 && !testResult.stdout.toString().includes("no-tests")) {
    issues.push({
      severity: "critical",
      category: "tests",
      title: "Tests failed",
      description: testResult.stderr.toString().slice(0, 500),
    })
  }

  const criticalIssues = issues.filter((i) => i.severity === "critical")

  return {
    layer: 1,
    passed: criticalIssues.length === 0,
    issues,
    duration: Date.now() - startTime,
  }
}
```

#### 4. Implement Layer 2: Structural Checks
**File**: `src/validation/layer2.ts`

```typescript
import type { ValidationResult, ValidationIssue, Layer2Config } from "./types"
import { DEFAULT_LAYER2_CONFIG } from "./types"

export interface Layer2Options {
  containerName: string
  featureId: string
  config?: Layer2Config
}

export async function runLayer2(options: Layer2Options): Promise<ValidationResult> {
  const startTime = Date.now()
  const issues: ValidationIssue[] = []
  const config = options.config ?? DEFAULT_LAYER2_CONFIG

  // 1. Check diff size
  const diffStats = await Bun.$`docker exec -u node ${options.containerName} git diff --stat HEAD~1`
    .text()
    .catch(() => "")

  const diffLines = diffStats.split("\n").length
  if (diffLines > config.maxDiffLines) {
    issues.push({
      severity: "warning",
      category: "diff-size",
      title: "Large diff detected",
      description: `Diff is ${diffLines} lines, exceeds limit of ${config.maxDiffLines}`,
    })
  }

  // 2. Check for secrets
  const diff = await Bun.$`docker exec -u node ${options.containerName} git diff HEAD~1`
    .text()
    .catch(() => "")

  for (const pattern of config.secretPatterns) {
    const regex = new RegExp(pattern, "i")
    if (regex.test(diff)) {
      issues.push({
        severity: "critical",
        category: "security",
        title: "Potential secret in diff",
        description: `Pattern matched: ${pattern}`,
      })
    }
  }

  // 3. Check for debug code
  for (const pattern of config.debugPatterns) {
    const regex = new RegExp(pattern)
    const matches = diff.match(new RegExp(`^\\+.*${pattern}`, "gm"))
    if (matches && matches.length > 0) {
      issues.push({
        severity: "warning",
        category: "debug-code",
        title: "Debug code detected",
        description: `Found ${matches.length} instance(s) of: ${pattern}`,
      })
    }
  }

  // 4. Check for obvious anti-patterns (in added lines only)
  const antiPatterns = [
    { pattern: /eval\s*\(/, name: "eval()" },
    { pattern: /innerHTML\s*=/, name: "innerHTML assignment" },
    { pattern: /dangerouslySetInnerHTML/, name: "dangerouslySetInnerHTML" },
  ]

  for (const { pattern, name } of antiPatterns) {
    const matches = diff.match(new RegExp(`^\\+.*${pattern.source}`, "gm"))
    if (matches && matches.length > 0) {
      issues.push({
        severity: "warning",
        category: "anti-pattern",
        title: `Potential anti-pattern: ${name}`,
        description: `Found ${matches.length} instance(s)`,
      })
    }
  }

  const criticalIssues = issues.filter((i) => i.severity === "critical")

  return {
    layer: 2,
    passed: criticalIssues.length === 0,
    issues,
    duration: Date.now() - startTime,
  }
}
```

#### 5. Implement Layer 3: Semantic Validator
**File**: `src/validation/layer3.ts`

```typescript
import type { ValidationResult, ValidationIssue } from "./types"

export interface Layer3Options {
  containerName: string
  featureId: string
  featureDescription: string
  acceptanceCriteria?: string
  verificationCommand: string
}

const VALIDATOR_PROMPT = (options: Layer3Options, diff: string): string => `
You are a SKEPTICAL senior engineer reviewing AI-generated code. Your job is to FIND PROBLEMS, not approve quickly.

## Feature Being Reviewed
- **ID**: ${options.featureId}
- **Description**: ${options.featureDescription}
- **Acceptance Criteria**: ${options.acceptanceCriteria || "Not specified"}
- **Verification Command**: ${options.verificationCommand}

## Code Diff
\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

## Your Review Process

1. **Requirement Alignment**: Does this implementation match the description?
2. **Completeness**: Is anything missing or partially implemented?
3. **Edge Cases**: Are edge cases handled (null, empty, large inputs)?
4. **Error Handling**: Are errors properly caught and handled?
5. **Security**: Any SQL injection, XSS, command injection, auth bypass?
6. **Code Quality**: Is this the RIGHT solution or a hack?

## Critical Questions
- Would you approve this in a code review from a junior engineer?
- Does the verification command actually verify the requirement?
- Are there obvious improvements being missed?

## Output Format
Respond with ONLY JSON, no other text:
\`\`\`json
{
  "verdict": "APPROVED" | "NEEDS_WORK",
  "confidence": 0.0-1.0,
  "summary": "...",
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "...",
      "title": "...",
      "description": "..."
    }
  ]
}
\`\`\`

Remember: Default to NEEDS_WORK if uncertain. Your reputation is on the line.
`

export async function runLayer3(options: Layer3Options): Promise<ValidationResult> {
  const startTime = Date.now()

  // Get the diff for this feature
  const diff = await Bun.$`docker exec -u node ${options.containerName} git diff HEAD~1`
    .text()
    .catch(() => "")

  if (!diff.trim()) {
    return {
      layer: 3,
      passed: false,
      issues: [{
        severity: "critical",
        category: "validation",
        title: "No changes to validate",
        description: "The diff is empty - nothing to review",
      }],
      duration: Date.now() - startTime,
    }
  }

  const prompt = VALIDATOR_PROMPT(options, diff)

  // Call Claude for semantic review
  const response = await Bun.$`docker exec -u node ${options.containerName} claude -p ${prompt}`
    .text()
    .catch((e) => {
      console.error("[Validation Layer 3] Claude call failed:", e.message)
      return '{"verdict": "NEEDS_WORK", "confidence": 0, "summary": "Validation failed", "issues": []}'
    })

  // Parse response
  let parsed: {
    verdict: "APPROVED" | "NEEDS_WORK"
    confidence: number
    summary: string
    issues: ValidationIssue[]
  }

  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim()
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    console.error("[Validation Layer 3] Failed to parse response")
    parsed = {
      verdict: "NEEDS_WORK",
      confidence: 0,
      summary: "Failed to parse validator response",
      issues: [{
        severity: "critical",
        category: "validation",
        title: "Parse error",
        description: "Could not parse validator response",
      }],
    }
  }

  return {
    layer: 3,
    passed: parsed.verdict === "APPROVED",
    issues: parsed.issues,
    duration: Date.now() - startTime,
  }
}
```

#### 6. Create Validation Pipeline Orchestrator
**File**: `src/validation/pipeline.ts`

```typescript
import type { ValidationReport, ValidationResult } from "./types"
import { runLayer1, type Layer1Options } from "./layer1"
import { runLayer2, type Layer2Options } from "./layer2"
import { runLayer3, type Layer3Options } from "./layer3"

export interface ValidationPipelineOptions {
  containerName: string
  featureId: string
  featureDescription: string
  acceptanceCriteria?: string
  verificationCommand: string
  workspacePath: string
  layers?: (1 | 2 | 3)[]
  verbose?: boolean
}

export async function runValidationPipeline(
  options: ValidationPipelineOptions
): Promise<ValidationReport> {
  const layers = options.layers ?? [1, 2, 3]
  const results: ValidationResult[] = []
  const startTime = new Date()

  // Layer 1: Automated Checks
  if (layers.includes(1)) {
    if (options.verbose) console.log("[Validation] Running Layer 1: Automated Checks...")
    const layer1Result = await runLayer1({
      containerName: options.containerName,
      featureId: options.featureId,
      verificationCommand: options.verificationCommand,
      workspacePath: options.workspacePath,
    })
    results.push(layer1Result)

    if (!layer1Result.passed) {
      if (options.verbose) console.log("[Validation] Layer 1 failed, stopping pipeline")
      return buildReport(options.featureId, startTime, results, "NEEDS_WORK")
    }
    if (options.verbose) console.log("[Validation] Layer 1 passed")
  }

  // Layer 2: Structural Checks
  if (layers.includes(2)) {
    if (options.verbose) console.log("[Validation] Running Layer 2: Structural Checks...")
    const layer2Result = await runLayer2({
      containerName: options.containerName,
      featureId: options.featureId,
    })
    results.push(layer2Result)

    if (!layer2Result.passed) {
      if (options.verbose) console.log("[Validation] Layer 2 failed, stopping pipeline")
      return buildReport(options.featureId, startTime, results, "NEEDS_WORK")
    }
    if (options.verbose) console.log("[Validation] Layer 2 passed")
  }

  // Layer 3: Semantic Validation
  if (layers.includes(3)) {
    if (options.verbose) console.log("[Validation] Running Layer 3: Semantic Validation...")
    const layer3Result = await runLayer3({
      containerName: options.containerName,
      featureId: options.featureId,
      featureDescription: options.featureDescription,
      acceptanceCriteria: options.acceptanceCriteria,
      verificationCommand: options.verificationCommand,
    })
    results.push(layer3Result)

    if (!layer3Result.passed) {
      if (options.verbose) console.log("[Validation] Layer 3 failed")
      return buildReport(options.featureId, startTime, results, "NEEDS_WORK")
    }
    if (options.verbose) console.log("[Validation] Layer 3 passed")
  }

  return buildReport(options.featureId, startTime, results, "APPROVED")
}

function buildReport(
  featureId: string,
  startTime: Date,
  layers: ValidationResult[],
  verdict: "APPROVED" | "NEEDS_WORK"
): ValidationReport {
  const allIssues = layers.flatMap((l) => l.issues)
  const criticalCount = allIssues.filter((i) => i.severity === "critical").length
  const warningCount = allIssues.filter((i) => i.severity === "warning").length

  const summary =
    verdict === "APPROVED"
      ? `Feature ${featureId} approved after ${layers.length} validation layers`
      : `Feature ${featureId} needs work: ${criticalCount} critical, ${warningCount} warnings`

  return {
    featureId,
    timestamp: startTime,
    layers,
    overallVerdict: verdict,
    summary,
  }
}
```

#### 7. Create Module Index
**File**: `src/validation/index.ts`

```typescript
export * from "./types"
export * from "./pipeline"
export * from "./layer1"
export * from "./layer2"
export * from "./layer3"
```

### Success Criteria

#### Automated Verification:
- [ ] All validation module files exist in `src/validation/`
- [ ] Unit tests pass: `bun test src/validation/`
- [ ] Layer 1 correctly detects failing tests/lint
- [ ] Layer 2 correctly detects secrets and debug code patterns
- [ ] Layer 3 returns structured JSON from Claude

#### Manual Verification:
- [ ] Run validation pipeline on a known-good feature, verify APPROVED
- [ ] Run validation pipeline on a feature with bugs, verify NEEDS_WORK
- [ ] Verify Layer 3 provides meaningful code review feedback

**Implementation Note**: After completing this phase, test the validation pipeline in isolation before integrating into ralph.ts.

---

## Phase 1d: Integration & Observability

### Overview
Wire the validation pipeline into ralph.ts and add basic observability for ZFC evaluations.

### Changes Required

#### 1. Update ralph.ts to Use Validation Pipeline

Add validation after Claude marks a feature complete. The orchestrator should:
1. Detect when Claude claims a feature is complete
2. Run the validation pipeline
3. If NEEDS_WORK, revert the feature status and continue

**File**: `ralph.ts` (additions to main loop)

After Claude runs and before accepting completion, add:

```typescript
import { runValidationPipeline } from "./src/validation"

// In the main loop, after checking features:
// Compare features before and after Claude run to detect newly completed features
const previousRemaining = remaining.map(f => f.id)
// ... run Claude ...
const afterFeaturesJson = await Bun.$`docker exec -u node ${containerName} cat /workspace/${featuresPath}`.text()
const afterFeatures = JSON.parse(afterFeaturesJson).features

// Find newly completed features
const newlyCompleted = afterFeatures.filter((f: any) =>
  f.passes === true && previousRemaining.includes(f.id)
)

// Validate each newly completed feature
if (config.validation.enabled) {
  for (const feature of newlyCompleted) {
    console.log(`[Validation] Validating feature: ${feature.id}`)

    const report = await runValidationPipeline({
      containerName,
      featureId: feature.id,
      featureDescription: feature.description,
      acceptanceCriteria: feature.acceptance,
      verificationCommand: feature.verification,
      workspacePath: "/workspace",
      layers: config.validation.layers,
      verbose: config.verbose,
    })

    if (report.overallVerdict === "NEEDS_WORK") {
      console.log(`[Validation] Feature ${feature.id} REJECTED: ${report.summary}`)

      // Log issues
      for (const layer of report.layers) {
        for (const issue of layer.issues) {
          console.log(`  [${issue.severity}] ${issue.title}: ${issue.description}`)
        }
      }

      // Revert the feature status
      await Bun.$`docker exec -u node ${containerName} bash -c "cd /workspace && jq '.features |= map(if .id == \"${feature.id}\" then .passes = false else . end)' ${featuresPath} > tmp.json && mv tmp.json ${featuresPath}"`

      // Append feedback for next iteration
      const feedback = `
[VALIDATION FAILED] Feature: ${feature.id}
${report.summary}
Issues:
${report.layers.flatMap(l => l.issues).map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n')}

NEXT ITERATION MUST address these issues before re-attempting.
`
      await Bun.$`docker exec -u node ${containerName} bash -c "echo '${feedback}' >> /workspace/ralph-progress.txt"`
    } else {
      console.log(`[Validation] Feature ${feature.id} APPROVED`)
    }
  }
}
```

#### 2. Add Metrics Collection
**File**: `src/observability/metrics.ts` (new file)

```typescript
export interface ZFCMetrics {
  evaluationType: string
  duration: number
  timestamp: Date
  success: boolean
  error?: string
}

export interface ValidationMetrics {
  featureId: string
  layers: number[]
  duration: number
  verdict: "APPROVED" | "NEEDS_WORK"
  issueCount: number
  timestamp: Date
}

export interface SessionMetrics {
  sessionId: string
  startTime: Date
  endTime?: Date
  iterations: number
  featuresCompleted: number
  featuresFailed: number
  zfcCalls: ZFCMetrics[]
  validations: ValidationMetrics[]
}

class MetricsCollector {
  private metrics: SessionMetrics

  constructor(sessionId: string) {
    this.metrics = {
      sessionId,
      startTime: new Date(),
      iterations: 0,
      featuresCompleted: 0,
      featuresFailed: 0,
      zfcCalls: [],
      validations: [],
    }
  }

  recordZFCCall(metrics: Omit<ZFCMetrics, "timestamp">) {
    this.metrics.zfcCalls.push({ ...metrics, timestamp: new Date() })
  }

  recordValidation(metrics: Omit<ValidationMetrics, "timestamp">) {
    this.metrics.validations.push({ ...metrics, timestamp: new Date() })
    if (metrics.verdict === "APPROVED") {
      this.metrics.featuresCompleted++
    } else {
      this.metrics.featuresFailed++
    }
  }

  incrementIterations() {
    this.metrics.iterations++
  }

  finalize(): SessionMetrics {
    this.metrics.endTime = new Date()
    return this.metrics
  }

  getSummary(): string {
    const duration = (this.metrics.endTime ?? new Date()).getTime() - this.metrics.startTime.getTime()
    const avgZfcDuration = this.metrics.zfcCalls.length > 0
      ? this.metrics.zfcCalls.reduce((sum, m) => sum + m.duration, 0) / this.metrics.zfcCalls.length
      : 0

    return `
=== Ralph Session Metrics ===
Duration: ${Math.round(duration / 1000)}s
Iterations: ${this.metrics.iterations}
Features Completed: ${this.metrics.featuresCompleted}
Features Failed: ${this.metrics.featuresFailed}
ZFC Calls: ${this.metrics.zfcCalls.length} (avg ${Math.round(avgZfcDuration)}ms)
Validations: ${this.metrics.validations.length}
`
  }
}

export { MetricsCollector }
```

#### 3. Add Observability Index
**File**: `src/observability/index.ts`

```typescript
export * from "./metrics"
```

#### 4. Wire Metrics into ralph.ts

Add at session start:
```typescript
import { MetricsCollector } from "./src/observability"

const metrics = new MetricsCollector(containerName)
```

Record ZFC calls (wrap evaluator calls):
```typescript
const startTime = Date.now()
const assessments = await evaluator.evaluateFeatureStatus(featuresJson, workspaceState)
metrics.recordZFCCall({
  evaluationType: "featureStatus",
  duration: Date.now() - startTime,
  success: true,
})
```

Print summary at session end:
```typescript
console.log(metrics.getSummary())
```

### Success Criteria

#### Automated Verification:
- [ ] `bun test` passes with all new code
- [ ] Ralph runs end-to-end with ZFC + validation enabled
- [ ] Metrics are collected and summary is printed at session end

#### Manual Verification:
- [ ] Run Ralph on a test project, verify validation catches intentional bugs
- [ ] Verify metrics summary shows ZFC call counts and durations
- [ ] Confirm session runs successfully from start to finish

**Implementation Note**: This phase completes the integration. Run a full end-to-end test with a simple features.json before considering Phase 1 complete.

---

## Testing Strategy

### Unit Tests

Create test files alongside each module:

- `src/zfc/evaluator.test.ts` - Test JSON parsing, prompt generation
- `src/zfc/claude-evaluator.test.ts` - Mock Claude responses, test parsing
- `src/validation/layer1.test.ts` - Test with mock command outputs
- `src/validation/layer2.test.ts` - Test pattern detection
- `src/validation/layer3.test.ts` - Mock Claude validator responses
- `src/validation/pipeline.test.ts` - Test layer orchestration

### Integration Tests

- `tests/integration/validation-pipeline.test.ts` - End-to-end validation

### Manual Testing Steps

1. **Verbose Mode**: Run Ralph with `RALPH_VERBOSE=true` to see all ZFC decisions
2. **Validation Disabled**: Run Ralph with `RALPH_VALIDATION_ENABLED=false` for quick iterations
3. **Validation Catches Bugs**: Run Ralph on a feature with intentional bugs, verify rejection
4. **Full Pipeline**: Run Ralph on a multi-feature project end-to-end

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RALPH_VERBOSE` | `false` | Log ZFC decisions and validation details |
| `RALPH_VALIDATION_ENABLED` | `true` | Enable validation pipeline (can disable for quick iterations) |

**Note**: ZFC is not configurable - it's the architecture. There is no `RALPH_ZFC_ENABLED` because ZFC is always on.

### Future: ralph.config.ts

```typescript
// ralph.config.ts (future)
export default {
  verbose: false,
  validation: {
    enabled: true,
    layers: [1, 2, 3],
    layer2: {
      maxDiffLines: 500,
      secretPatterns: [...],
      debugPatterns: [...],
    },
  },
}
```

---

## References

- **ZFC Concept**: `docs/ZFC-IMPLEMENTATION-PLAN.md`
- **Architecture**: `docs/ARCHITECTURE-V2.md`
- **Beads Best Practices**: `thoughts/shared/research/2026-01-09-beads-best-practices-yegge.md`
- **Current Implementation**: `ralph.ts`, `src/container.ts`

---

*Document Version: 1.0.0*
*Last Updated: January 9, 2026*
*Scope: Phase 1 - ZFC + Validation Pipeline*
