# Zero Framework Cognition (ZFC) Implementation Plan

**Based on**: Steve Yegge's "Zero Framework Cognition: A Way to Build Resilient AI Applications"
**Author**: Engineering Team
**Date**: January 2026
**Status**: Implementation Ready

---

## Executive Summary

This document outlines the integration of **Zero Framework Cognition (ZFC)** principles into Ralph. ZFC mandates that ALL cognitive decisions be delegated to AI models, eliminating heuristics, regex, pattern matching, and hardcoded decision logic from the orchestrator.

The result: a more resilient, adaptable system that handles edge cases gracefully instead of failing on unexpected inputs.

---

## Table of Contents

1. [What is ZFC?](#1-what-is-zfc)
2. [Current ZFC Violations in Ralph](#2-current-zfc-violations-in-ralph)
3. [ZFC-Compliant Architecture](#3-zfc-compliant-architecture)
4. [Implementation Plan](#4-implementation-plan)
5. [Cost Optimization](#5-cost-optimization)
6. [Migration Strategy](#6-migration-strategy)

---

## 1. What is ZFC?

### 1.1 Core Principle

> "Zero Framework Cognition means ALL decisions are delegated to AI, with no heuristics, regex, or parsing."
> — Steve Yegge

The framework is a **thin, safe, deterministic shell** around AI reasoning. The orchestrator handles IO, plumbing, and policy enforcement. The AI handles all cognitive work.

### 1.2 Why ZFC Matters

Pattern matching misses edge cases:
- What if output isn't in English?
- What about synonyms ("ended", "concluded", "finalized" vs "done", "complete")?
- What about unexpected formats?

ZFC violations make programs **brittle**:
- More failures
- More retries
- Lower throughput
- Higher downtime

ZFC-compliant apps are **naturally resilient** because AIs handle edge cases that would break regex/heuristics.

### 1.3 The ZFC Division

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZFC-COMPLIANT SYSTEM                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              ORCHESTRATOR (Dumb Pipes)                       │ │
│  │                                                               │ │
│  │  ALLOWED:                        FORBIDDEN:                   │ │
│  │  • IO operations                 • Ranking/scoring            │ │
│  │  • File read/write               • Pattern matching           │ │
│  │  • JSON parsing                  • Keyword detection          │ │
│  │  • Schema validation             • Heuristic classification   │ │
│  │  • Timeout enforcement           • Semantic analysis          │ │
│  │  • Rate limiting                 • "What should happen next"  │ │
│  │  • Mechanical transforms         • Quality judgment           │ │
│  │  • State persistence             • Fallback decision trees    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  AI MODELS (Smart Endpoints)                  │ │
│  │                                                               │ │
│  │  • Evaluate if feature is complete                           │ │
│  │  • Decide what to work on next                               │ │
│  │  • Assess if progress is being made                          │ │
│  │  • Determine if session should continue                      │ │
│  │  • Classify error severity                                   │ │
│  │  • Decompose complex tasks                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 The Correct ZFC Flow

```
1. Gather Raw Context (IO only)
   → Read files, fetch state, collect constraints

2. Call AI for Decisions
   → Classification, selection, ordering, next steps

3. Validate Structure
   → Schema conformance, safety checks, policy enforcement

4. Execute Mechanically
   → Run AI's decisions without modification
```

---

## 2. Current ZFC Violations in Ralph

### 2.1 Violation Inventory

| Location | Code | Violation Type | Impact |
|----------|------|----------------|--------|
| `ralph.ts:223-224` | `getRemainingFeatures()` | Heuristic filtering | Misses nuanced completion states |
| `ralph.ts:258-259` | `hasUnpushedCommits()` | String length check | Binary decision from complex state |
| `ralph.ts:247-255` | Timeout = failure | Heuristic classification | Ignores partial progress |
| `ralph.ts:18-19` | `MAX_NO_CHANGE = 3` | Hardcoded policy | Can't adapt to project complexity |
| `container.ts:113-116` | `!f.passes` filter | Boolean heuristic | No semantic evaluation |
| `ralph.ts:37` | `parseContainerRunning()` | String comparison | Could miss edge cases |

### 2.2 Detailed Analysis

#### Violation 1: Feature Completion Detection

```typescript
// CURRENT (ZFC VIOLATION)
// ralph.ts:223-224, container.ts:113-116

export function getRemainingFeatures(featuresJson: string): Array<...> {
  const parsed = JSON.parse(featuresJson);
  return parsed.features.filter((f: { passes: boolean }) => !f.passes);
  //                                                         ^^^^^^^^
  //                                   PROBLEM: Binary check, no semantic evaluation
}
```

**Why it's a violation**: The orchestrator decides what's "remaining" using a boolean. But:
- What if a feature is partially complete?
- What if passes=true but verification is flaky?
- What if dependencies changed?

**ZFC-compliant approach**: Ask AI to evaluate feature state.

#### Violation 2: Circuit Breaker

```typescript
// CURRENT (ZFC VIOLATION)
// ralph.ts:18-19, 247-255

const MAX_NO_CHANGE = 3;  // Hardcoded heuristic

if (noChangeCount >= MAX_NO_CHANGE) {
  console.log("CIRCUIT BREAKER: No progress after timeouts");
  break;
}
```

**Why it's a violation**: Hardcoded policy that can't adapt. But:
- What if the project is complex and 3 iterations isn't enough?
- What if there's a transient issue that resolved itself?
- What if the agent is making progress but not committing yet?

**ZFC-compliant approach**: Ask AI to assess whether to continue.

#### Violation 3: Push Status Detection

```typescript
// CURRENT (ZFC VIOLATION)
// ralph.ts:258-259, container.ts:121-123

export function hasUnpushedCommits(gitLogOutput: string): boolean {
  return gitLogOutput.trim().length > 0;
  //     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //     PROBLEM: String length as semantic meaning
}
```

**Why it's a violation**: Checks string length, not semantic content. But:
- What if the output has formatting but no real commits?
- What if there are commits that shouldn't be pushed?

#### Violation 4: Timeout Handling

```typescript
// CURRENT (ZFC VIOLATION)
// ralph.ts:247-255

if (!success) {  // success = false on timeout
  noChangeCount++;
  if (noChangeCount >= MAX_NO_CHANGE) {
    // Assume no progress
    break;
  }
  continue;
}
```

**Why it's a violation**: Timeout is treated as failure. But:
- Claude might have made significant progress before timeout
- The container might have committed but not returned cleanly
- Partial work might be valuable

---

## 3. ZFC-Compliant Architecture

### 3.1 New Component: AI Evaluator

```
┌─────────────────────────────────────────────────────────────────┐
│                    RALPH + ZFC ARCHITECTURE                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      ORCHESTRATOR                             │ │
│  │                                                               │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐                │ │
│  │  │  Session  │  │ Container │  │    Git    │                │ │
│  │  │  Manager  │  │  Manager  │  │  Manager  │                │ │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                │ │
│  │        │              │              │                       │ │
│  │        └──────────────┼──────────────┘                       │ │
│  │                       │                                       │ │
│  │                       ▼                                       │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                 AI EVALUATOR (NEW)                       │ │ │
│  │  │                                                          │ │ │
│  │  │  evaluateFeatureStatus()   → "complete" | "in_progress" │ │ │
│  │  │  assessSessionProgress()   → "continue" | "stuck" | ... │ │ │
│  │  │  analyzeTimeout()          → "progress" | "no_progress" │ │ │
│  │  │  decidePushStatus()        → "needs_push" | "clean"     │ │ │
│  │  │  classifyError()           → severity, action           │ │ │
│  │  │  decomposeTask()           → subtasks[]                 │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  MODEL ROUTING (Cost Optimization)            │ │
│  │                                                               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │ │
│  │  │   Haiku     │  │   Sonnet    │  │   Opus      │          │ │
│  │  │   (cheap)   │  │  (balanced) │  │ (expensive) │          │ │
│  │  │             │  │             │  │             │          │ │
│  │  │ • Status    │  │ • Complex   │  │ • Strategy  │          │ │
│  │  │   checks    │  │   decisions │  │   decisions │          │ │
│  │  │ • Simple    │  │ • Task      │  │ • Error     │          │ │
│  │  │   classify  │  │   decompose │  │   recovery  │          │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 AI Evaluator Interface

```typescript
// src/zfc/evaluator.ts

export interface AIEvaluator {
  /**
   * Evaluate which features still need work
   * Replaces: getRemainingFeatures() boolean filter
   */
  evaluateFeatureStatus(
    featuresJson: string,
    workspaceState: WorkspaceState
  ): Promise<FeatureAssessment[]>;

  /**
   * Assess whether the session is making progress
   * Replaces: noChangeCount >= MAX_NO_CHANGE
   */
  assessSessionProgress(
    iterationHistory: IterationResult[],
    currentState: SessionState
  ): Promise<ProgressAssessment>;

  /**
   * Analyze what happened during a timeout
   * Replaces: timeout = failure assumption
   */
  analyzeTimeout(
    containerState: ContainerState,
    lastKnownProgress: string
  ): Promise<TimeoutAnalysis>;

  /**
   * Decide if there are unpushed commits worth pushing
   * Replaces: hasUnpushedCommits() string length check
   */
  decidePushStatus(
    gitState: GitState
  ): Promise<PushDecision>;

  /**
   * Classify an error and recommend action
   * Replaces: error type switch statements
   */
  classifyError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorClassification>;

  /**
   * Decompose a complex feature into subtasks
   * NEW: enables better task management
   */
  decomposeTask(
    feature: Feature,
    codebaseContext: CodebaseContext
  ): Promise<TaskDecomposition>;
}

// Response types with structured outputs
interface FeatureAssessment {
  featureId: string;
  status: 'complete' | 'in_progress' | 'blocked' | 'not_started';
  confidence: number;
  reasoning: string;
  blockedBy?: string[];
  estimatedEffort?: 'small' | 'medium' | 'large';
}

interface ProgressAssessment {
  decision: 'continue' | 'pause' | 'stuck' | 'abort';
  reasoning: string;
  suggestedAction?: string;
  stuckReason?: string;
}

interface TimeoutAnalysis {
  madeProgress: boolean;
  progressDescription?: string;
  recommendation: 'resume' | 'retry' | 'skip' | 'abort';
  reasoning: string;
}

interface PushDecision {
  shouldPush: boolean;
  reasoning: string;
  unpushedCommits: number;
  commitSummary?: string;
}

interface ErrorClassification {
  severity: 'critical' | 'recoverable' | 'ignorable';
  category: 'network' | 'auth' | 'resource' | 'logic' | 'unknown';
  action: 'retry' | 'skip' | 'abort' | 'escalate';
  reasoning: string;
}

interface TaskDecomposition {
  subtasks: Subtask[];
  dependencies: [string, string][];  // [task, dependsOn]
  estimatedTotalEffort: 'small' | 'medium' | 'large';
}
```

### 3.3 Implementation Example

```typescript
// src/zfc/evaluator-impl.ts

import Anthropic from '@anthropic-ai/sdk';

export class ClaudeEvaluator implements AIEvaluator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async evaluateFeatureStatus(
    featuresJson: string,
    workspaceState: WorkspaceState
  ): Promise<FeatureAssessment[]> {
    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',  // Cost-optimized for simple evaluation
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are evaluating the completion status of features in a software project.

## Features Definition
\`\`\`json
${featuresJson}
\`\`\`

## Current Workspace State
- Modified files: ${workspaceState.modifiedFiles.join(', ')}
- Last commit: ${workspaceState.lastCommitMessage}
- Test status: ${workspaceState.testStatus}

## Task
For each feature, assess:
1. Is it complete, in progress, blocked, or not started?
2. How confident are you (0-1)?
3. Brief reasoning

Respond with JSON array:
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
      }]
    });

    return this.parseFeatureAssessments(response);
  }

  async assessSessionProgress(
    iterationHistory: IterationResult[],
    currentState: SessionState
  ): Promise<ProgressAssessment> {
    const response = await this.client.messages.create({
      model: 'claude-3-5-sonnet-latest',  // More nuanced decision
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a session supervisor deciding whether an AI coding session should continue.

## Iteration History (last ${iterationHistory.length} iterations)
${iterationHistory.map((r, i) => `
Iteration ${i + 1}:
- Duration: ${r.duration}ms
- Outcome: ${r.outcome}
- Git changes: ${r.gitChanges}
- Features completed: ${r.featuresCompleted}
- Error: ${r.error || 'none'}
`).join('\n')}

## Current State
- Features remaining: ${currentState.featuresRemaining}
- Total iterations: ${currentState.totalIterations}
- Consecutive no-change: ${currentState.noChangeStreak}

## Decision Required
Should we:
- **continue**: Keep iterating, progress is being made
- **pause**: Temporary issue, wait and retry
- **stuck**: No progress despite attempts, needs different approach
- **abort**: Fundamental issue, stop session

Respond with JSON:
\`\`\`json
{
  "decision": "continue|pause|stuck|abort",
  "reasoning": "...",
  "suggestedAction": "..." // if stuck or pause
}
\`\`\``
      }]
    });

    return this.parseProgressAssessment(response);
  }

  async analyzeTimeout(
    containerState: ContainerState,
    lastKnownProgress: string
  ): Promise<TimeoutAnalysis> {
    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `A Claude session was killed after timeout. Analyze the state.

## Container State at Timeout
- Running processes: ${containerState.processes}
- Last file modified: ${containerState.lastModified}
- Git status: ${containerState.gitStatus}
- Progress log tail:
\`\`\`
${lastKnownProgress}
\`\`\`

## Questions
1. Did Claude make meaningful progress before timeout?
2. Should we resume from here, retry fresh, skip this task, or abort?

Respond with JSON:
\`\`\`json
{
  "madeProgress": true|false,
  "progressDescription": "...",
  "recommendation": "resume|retry|skip|abort",
  "reasoning": "..."
}
\`\`\``
      }]
    });

    return this.parseTimeoutAnalysis(response);
  }
}
```

---

## 4. Implementation Plan

### 4.1 Phase 1: Core Evaluator (Week 1-2)

#### Tasks

1. **Create `src/zfc/` directory structure**
   ```
   src/zfc/
   ├── evaluator.ts      # Interface definitions
   ├── claude-evaluator.ts  # Claude implementation
   ├── prompts/          # Evaluation prompt templates
   │   ├── feature-status.md
   │   ├── session-progress.md
   │   ├── timeout-analysis.md
   │   └── error-classification.md
   └── index.ts          # Exports
   ```

2. **Implement `AIEvaluator` interface**
   - `evaluateFeatureStatus()`
   - `assessSessionProgress()`
   - `analyzeTimeout()`
   - `decidePushStatus()`

3. **Add Anthropic SDK dependency**
   ```bash
   bun add @anthropic-ai/sdk
   ```

4. **Create prompt templates**
   - Structured prompts with JSON output schemas
   - Version-controlled in `src/zfc/prompts/`

#### Deliverables
- [ ] `src/zfc/evaluator.ts` - Interface
- [ ] `src/zfc/claude-evaluator.ts` - Implementation
- [ ] Unit tests with mocked responses
- [ ] Prompt templates

### 4.2 Phase 2: Integration (Week 2-3)

#### Tasks

1. **Replace `getRemainingFeatures()`**

   ```typescript
   // BEFORE (ralph.ts:222-224)
   const featuresJson = await Bun.$`...`.text();
   const remaining = getRemainingFeatures(featuresJson);

   // AFTER
   const featuresJson = await Bun.$`...`.text();
   const workspaceState = await getWorkspaceState(containerName);
   const assessments = await evaluator.evaluateFeatureStatus(featuresJson, workspaceState);
   const remaining = assessments.filter(a => a.status !== 'complete');
   ```

2. **Replace circuit breaker heuristic**

   ```typescript
   // BEFORE (ralph.ts:247-255)
   if (noChangeCount >= MAX_NO_CHANGE) {
     console.log("CIRCUIT BREAKER");
     break;
   }

   // AFTER
   const progress = await evaluator.assessSessionProgress(iterationHistory, sessionState);
   if (progress.decision === 'abort') {
     console.log(`Session ending: ${progress.reasoning}`);
     break;
   } else if (progress.decision === 'stuck') {
     console.log(`Stuck: ${progress.reasoning}`);
     console.log(`Suggested: ${progress.suggestedAction}`);
     // Could try the suggestion or abort
   }
   ```

3. **Replace timeout handling**

   ```typescript
   // BEFORE (ralph.ts:247-255)
   if (!success) {
     noChangeCount++;
     continue;
   }

   // AFTER
   if (!success) {
     const containerState = await getContainerState(containerName);
     const analysis = await evaluator.analyzeTimeout(containerState, lastProgress);

     if (analysis.madeProgress) {
       console.log(`Timeout but progress made: ${analysis.progressDescription}`);
       if (analysis.recommendation === 'resume') {
         // Continue from current state
         continue;
       }
     }

     if (analysis.recommendation === 'abort') {
       break;
     }
   }
   ```

4. **Replace push status check**

   ```typescript
   // BEFORE (ralph.ts:258-262)
   const pushCheck = await Bun.$`...`.text();
   if (hasUnpushedCommits(pushCheck)) {
     // push
   }

   // AFTER
   const gitState = await getGitState(containerName);
   const pushDecision = await evaluator.decidePushStatus(gitState);
   if (pushDecision.shouldPush) {
     console.log(`Pushing: ${pushDecision.commitSummary}`);
     // push
   }
   ```

#### Deliverables
- [ ] Updated `ralph.ts` with ZFC integration
- [ ] `src/zfc/state.ts` - Workspace/container state helpers
- [ ] Integration tests
- [ ] Metrics for AI evaluation calls

### 4.3 Phase 3: Model Routing (Week 3-4)

#### Tasks

1. **Implement model tier routing**

   ```typescript
   // src/zfc/router.ts

   type ModelTier = 'haiku' | 'sonnet' | 'opus';

   interface EvaluationRequest {
     type: 'feature_status' | 'session_progress' | 'timeout_analysis' |
           'error_classification' | 'task_decomposition';
     complexity: 'low' | 'medium' | 'high';
   }

   function routeToModel(request: EvaluationRequest): ModelTier {
     // Simple decisions → Haiku (cheap)
     if (request.type === 'feature_status' && request.complexity === 'low') {
       return 'haiku';
     }

     // Complex strategic decisions → Opus (expensive)
     if (request.type === 'task_decomposition' ||
         (request.type === 'error_classification' && request.complexity === 'high')) {
       return 'opus';
     }

     // Default → Sonnet (balanced)
     return 'sonnet';
   }
   ```

2. **Add cost tracking**

   ```typescript
   // src/zfc/metrics.ts

   interface EvaluationMetrics {
     type: string;
     model: ModelTier;
     inputTokens: number;
     outputTokens: number;
     latencyMs: number;
     cost: number;  // Estimated USD
   }

   function estimateCost(model: ModelTier, inputTokens: number, outputTokens: number): number {
     const rates = {
       haiku: { input: 0.00025, output: 0.00125 },    // per 1K tokens
       sonnet: { input: 0.003, output: 0.015 },
       opus: { input: 0.015, output: 0.075 }
     };
     const rate = rates[model];
     return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
   }
   ```

3. **Optimize prompts for each tier**
   - Haiku: Shorter, more structured prompts
   - Sonnet: Balanced detail
   - Opus: Full context for complex decisions

#### Deliverables
- [ ] `src/zfc/router.ts` - Model routing logic
- [ ] `src/zfc/metrics.ts` - Cost tracking
- [ ] Tier-optimized prompt variants
- [ ] Cost dashboard/reporting

### 4.4 Phase 4: Advanced Patterns (Week 4+)

#### Tasks

1. **AI-driven task decomposition**
   - Let AI break complex features into subtasks
   - Create dependency graph
   - Integrates with Beads system from ARCHITECTURE-V2

2. **Self-healing workflows**
   - AI can request orchestration actions
   - "This task is too big, break it up"
   - "I need to skip this and try another"
   - "This requires human input"

3. **Confidence-based retries**
   - Low confidence assessments trigger re-evaluation
   - Different model for second opinion

#### Deliverables
- [ ] `src/zfc/decomposition.ts` - Task decomposition
- [ ] `src/zfc/healing.ts` - Self-healing patterns
- [ ] Integration with Beads (from ARCHITECTURE-V2)

---

## 5. Cost Optimization

### 5.1 Model Tier Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    COST OPTIMIZATION PYRAMID                     │
│                                                                   │
│                         ┌───────┐                                │
│                         │ OPUS  │  ~5% of calls                  │
│                         │       │  • Strategy decisions          │
│                         │       │  • Complex decomposition       │
│                         │       │  • Error recovery              │
│                         └───┬───┘                                │
│                             │                                    │
│                      ┌──────┴──────┐                             │
│                      │   SONNET    │  ~25% of calls              │
│                      │             │  • Progress assessment      │
│                      │             │  • Nuanced classification   │
│                      │             │  • Validation review        │
│                      └──────┬──────┘                             │
│                             │                                    │
│               ┌─────────────┴─────────────┐                      │
│               │          HAIKU            │  ~70% of calls       │
│               │                           │  • Status checks     │
│               │                           │  • Simple decisions  │
│               │                           │  • Quick classify    │
│               └───────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Evaluation Call Frequency

| Evaluation Type | When Called | Model | Est. Cost/Call |
|-----------------|-------------|-------|----------------|
| Feature status | Each iteration | Haiku | ~$0.001 |
| Session progress | Each iteration | Sonnet | ~$0.01 |
| Timeout analysis | On timeout | Haiku | ~$0.002 |
| Push decision | After Claude runs | Haiku | ~$0.001 |
| Error classification | On error | Sonnet/Opus | ~$0.02 |
| Task decomposition | New complex feature | Opus | ~$0.10 |

### 5.3 Estimated Session Cost

For a typical 20-feature session with ~50 iterations:

| Component | Calls | Cost/Call | Total |
|-----------|-------|-----------|-------|
| Feature status | 50 | $0.001 | $0.05 |
| Session progress | 50 | $0.01 | $0.50 |
| Timeout analysis | ~5 | $0.002 | $0.01 |
| Push decision | 50 | $0.001 | $0.05 |
| Error classification | ~10 | $0.02 | $0.20 |
| Task decomposition | ~5 | $0.10 | $0.50 |
| **ZFC Overhead** | | | **~$1.31** |

Compare to Claude Code API costs for 50 iterations: **~$50-100**

**ZFC adds ~1-2% cost overhead for significant resilience gains.**

### 5.4 Caching Strategies

```typescript
// src/zfc/cache.ts

interface EvaluationCache {
  // Cache feature status until git state changes
  featureStatus: Map<string, { assessment: FeatureAssessment; gitHash: string }>;

  // Cache decomposition permanently (task structure doesn't change)
  decomposition: Map<string, TaskDecomposition>;
}

async function evaluateWithCache(
  evaluator: AIEvaluator,
  cache: EvaluationCache,
  featuresJson: string,
  currentGitHash: string
): Promise<FeatureAssessment[]> {
  const cacheKey = hashFeatures(featuresJson);
  const cached = cache.featureStatus.get(cacheKey);

  if (cached && cached.gitHash === currentGitHash) {
    return [cached.assessment];  // No git changes, reuse assessment
  }

  const assessment = await evaluator.evaluateFeatureStatus(...);
  cache.featureStatus.set(cacheKey, { assessment, gitHash: currentGitHash });
  return assessment;
}
```

---

## 6. Migration Strategy

### 6.1 Incremental Adoption

ZFC can be adopted incrementally with feature flags:

```typescript
// ralph.config.ts

export interface ZFCConfig {
  enabled: boolean;
  evaluations: {
    featureStatus: boolean;    // Replace getRemainingFeatures
    sessionProgress: boolean;  // Replace circuit breaker
    timeoutAnalysis: boolean;  // Replace timeout=failure
    pushDecision: boolean;     // Replace hasUnpushedCommits
  };
  modelRouting: {
    enabled: boolean;
    defaultModel: 'haiku' | 'sonnet' | 'opus';
  };
  caching: {
    enabled: boolean;
    ttlMs: number;
  };
}

// Default: everything off (current behavior)
export const DEFAULT_ZFC_CONFIG: ZFCConfig = {
  enabled: false,
  evaluations: {
    featureStatus: false,
    sessionProgress: false,
    timeoutAnalysis: false,
    pushDecision: false,
  },
  modelRouting: {
    enabled: false,
    defaultModel: 'sonnet',
  },
  caching: {
    enabled: false,
    ttlMs: 60000,
  },
};
```

### 6.2 Rollout Plan

```
Week 1-2: Development
├── Implement AIEvaluator interface
├── Create Claude implementation
├── Write unit tests with mocks
└── Create prompt templates

Week 2-3: Integration
├── Add feature flags to ralph.config.ts
├── Integrate behind flags
├── A/B test: ZFC vs current behavior
└── Measure resilience + cost

Week 3-4: Model Routing
├── Implement tier routing
├── Optimize prompts per tier
├── Add cost tracking
└── Dashboard for cost visibility

Week 4+: Full Rollout
├── Enable ZFC by default
├── Deprecate old heuristics
├── Add advanced patterns
└── Document learnings
```

### 6.3 Rollback Plan

If ZFC causes issues:

1. **Immediate**: Set `zfc.enabled: false` in config
2. **Per-evaluation**: Disable specific evaluations
3. **Model issues**: Override `defaultModel` to known-good tier
4. **Cost concerns**: Enable aggressive caching

---

## 7. Success Metrics

### 7.1 Resilience Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| False circuit breaks | ~15% | <5% | Sessions stopped that had potential |
| Timeout misclassification | ~20% | <5% | Timeouts treated as failure despite progress |
| Feature completion accuracy | ~85% | >95% | Features marked complete that are actually complete |
| Edge case handling | Unknown | Tracked | Novel situations handled gracefully |

### 7.2 Cost Metrics

| Metric | Baseline | With ZFC | Change |
|--------|----------|----------|--------|
| Session API cost | $50-100 | $51-101 | +1-2% |
| Iterations to completion | N | N-10% | -10% (fewer false restarts) |
| Human intervention rate | X% | X-50% | -50% (better self-healing) |

### 7.3 Observability

```typescript
// Log every AI evaluation
{
  "event": "zfc_evaluation",
  "type": "session_progress",
  "model": "sonnet",
  "input_tokens": 1234,
  "output_tokens": 256,
  "latency_ms": 1523,
  "cost_usd": 0.0108,
  "decision": "continue",
  "confidence": 0.85
}
```

---

## Appendix A: Prompt Templates

### A.1 Feature Status Evaluation

```markdown
# Feature Status Evaluation

You are evaluating completion status for features in a software project.

## Context
- Project: {{project_name}}
- Git branch: {{branch}}
- Last commit: {{last_commit}}

## Features
```json
{{features_json}}
```

## Workspace State
- Modified files since last commit: {{modified_files}}
- Test results: {{test_results}}
- Build status: {{build_status}}

## Instructions
For each feature, determine:
1. **Status**: complete | in_progress | blocked | not_started
2. **Confidence**: 0.0 to 1.0
3. **Reasoning**: Brief explanation

Consider:
- Does the verification command pass?
- Are there uncommitted changes related to this feature?
- Are dependencies satisfied?
- Is the implementation complete or partial?

## Output Format
```json
[
  {
    "featureId": "...",
    "status": "...",
    "confidence": 0.0,
    "reasoning": "..."
  }
]
```
```

### A.2 Session Progress Assessment

```markdown
# Session Progress Assessment

You are a supervisor deciding whether an AI coding session should continue.

## Session History
{{#each iterations}}
### Iteration {{@index}}
- Duration: {{duration}}ms
- Outcome: {{outcome}}
- Git changes: {{git_changes}}
- Features before: {{features_before}}
- Features after: {{features_after}}
- Notes: {{notes}}
{{/each}}

## Current State
- Total iterations: {{total_iterations}}
- Features remaining: {{features_remaining}}
- Consecutive no-change iterations: {{no_change_streak}}
- Last error (if any): {{last_error}}

## Decision Options
- **continue**: Progress is being made, keep iterating
- **pause**: Temporary issue (e.g., rate limit), wait and retry
- **stuck**: No progress despite attempts, needs different approach
- **abort**: Fundamental issue, stop session

## Analysis Guidelines
1. Look at trends, not just the last iteration
2. Consider if errors are transient or fundamental
3. "No git changes" doesn't mean no progress (could be debugging)
4. Check if the same approach keeps failing

## Output Format
```json
{
  "decision": "continue|pause|stuck|abort",
  "reasoning": "...",
  "suggestedAction": "..." // if stuck or pause
}
```
```

---

## Appendix B: References

- [Steve Yegge: Zero Framework Cognition](https://steve-yegge.medium.com/zero-framework-cognition-a-way-to-build-resilient-ai-applications-56b090ed3e69)
- [Martin Fowler: Smart Endpoints and Dumb Pipes](https://martinfowler.com/articles/microservices.html#SmartEndpointsAndDumbPipes)
- [Andrej Karpathy: Software 2.0](https://karpathy.medium.com/software-2-0-a64152b37c35)
- [Steve Yegge: VC (AI-orchestrated coding agent)](https://github.com/steveyegge/vc)
- [Steve Yegge: Gas Town (multi-agent orchestrator)](https://github.com/steveyegge/gastown)

---

*Document Version: 1.0.0*
*Last Updated: January 9, 2026*
