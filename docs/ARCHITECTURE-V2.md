---
date: 2026-01-09T12:00:00-08:00
authors:
  - name: Engineering Team
    role: Architecture Design
git_commit: 6166d412b4c5b53c828812a95680fbc5df627320
branch: main
repository: ralph
topic: "Ralph 2.0 Architecture - Multi-Agent Autonomous Coding System"
tags: [architecture, ralph-wiggum-loop, beads, validation, multi-agent, autonomous-coding]
status: draft
version: 1.0.0
last_updated: 2026-01-09
last_updated_by: Engineering Team
---

# Ralph 2.0 Architecture Document

**Date**: January 9, 2026
**Status**: Draft for Review
**Version**: 1.0.0

---

## Executive Summary

Ralph 2.0 transforms our current single-agent Docker orchestrator into a **multi-agent, validation-first autonomous coding system** with dependency-aware task management via Beads integration. The key differentiators:

1. **Adversarial Validation Pipeline** - Every implementation verified by skeptical validator agent
2. **Beads Integration** - Graph-based task dependencies replace flat features.json
3. **Multi-Worker Parallelism** - Horizontal scaling with coordinator pattern
4. **Enhanced Stuck Detection** - Semantic analysis beyond git diff
5. **Comprehensive Observability** - Session recording, metrics, dashboards

---

## Background: The Ralph Wiggum Loop

### Origin and Attribution

The **Ralph Wiggum Loop** technique was created by **Geoffrey Huntley** ([@ghuntley](https://github.com/ghuntley)) in mid-2025 and has become one of the most influential patterns for autonomous AI coding.

> **Note**: Geoffrey Huntley explicitly prefers "Geoffrey" over "Geoff" in formal references.

**Key Resources**:
- Primary source: [ghuntley.com/ralph/](https://ghuntley.com/ralph/)
- Workshop: [How to Build a Coding Agent](https://ghuntley.com/agent/)
- GitHub: [ghuntley/how-to-build-a-coding-agent](https://github.com/ghuntley/how-to-build-a-coding-agent)

### Core Concept

In its purest form, Ralph is a Bash loop that repeatedly feeds prompts to an AI coding agent:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Named after Ralph Wiggum from The Simpsons (the "relentlessly optimistic and undeterred" character), the technique works by:

1. **Fresh Context Per Iteration** - Instead of maintaining context in the LLM's memory, progress persists in files and git history
2. **Self-Correction** - Each iteration provides a fresh context window, preventing context pollution
3. **Incremental Progress** - The AI sees its previous work, self-corrects, and makes progress
4. **Deterministic Imperfection** - Produces predictable, addressable failure modes

As Huntley describes it:
> "That's the beauty of Ralph - the technique is deterministically bad in an undeterministic world."

### Key Principles

| Principle | Description |
|-----------|-------------|
| **Context Engineering** | State lives in files and git history, not in LLM memory |
| **Eventual Consistency** | Iteration beats perfection; faith in accumulated progress |
| **Carve Small Work Units** | Break work into small, independent context windows |
| **Naive Persistence** | Power comes from "unsanitized feedback" where the LLM confronts its own mess |

### Our Implementation: "Pure Ralph"

This project implements what Huntley calls **Pure Ralph** - external orchestration with fresh context per iteration, as opposed to plugin-based approaches that reuse session context.

Key characteristics of our Pure Ralph implementation:
- External orchestrator (`ralph.ts`) loops outside Claude
- Fresh `claude -p` invocation each iteration
- Filesystem/git as sole memory
- Container isolation with network restrictions
- Circuit breaker for stuck detection

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Design Principles](#2-design-principles)
3. [System Architecture](#3-system-architecture)
4. [Component Deep Dives](#4-component-deep-dives)
5. [Data Models](#5-data-models)
6. [API Contracts](#6-api-contracts)
7. [Security Model](#7-security-model)
8. [Migration Path](#8-migration-path)
9. [Implementation Phases](#9-implementation-phases)
10. [Open Questions](#10-open-questions)

---

## 1. Current State Analysis

### 1.1 Existing Architecture

```
+-------------------------------------------------------------+
|                     HOST SYSTEM                              |
|  +-----------------------------------------------------+    |
|  |                    ralph.ts                          |    |
|  |  - Parse args (src/args.ts)                         |    |
|  |  - Create Docker container                          |    |
|  |  - Copy project into container                      |    |
|  |  - Run Claude with instructions                     |    |
|  |  - Check for git changes                            |    |
|  |  - Loop until complete or circuit breaker           |    |
|  +-------------------------+---------------------------+    |
|                            |                                 |
|                            v                                 |
|  +-----------------------------------------------------+    |
|  |              DOCKER CONTAINER                        |    |
|  |  +-----------------------------------------------+  |    |
|  |  |           Network Firewall                     |  |    |
|  |  |  - Whitelist: api.anthropic.com, GitHub,      |  |    |
|  |  |    npm, sentry, statsig                        |  |    |
|  |  |  - Block all other outbound                    |  |    |
|  |  +-----------------------------------------------+  |    |
|  |                                                      |    |
|  |  +-----------------------------------------------+  |    |
|  |  |             Claude Code CLI                    |  |    |
|  |  |  - Reads .ralph-prompt.md                     |  |    |
|  |  |  - Implements features from features.json     |  |    |
|  |  |  - Commits and pushes to git                  |  |    |
|  |  +-----------------------------------------------+  |    |
|  |                                                      |    |
|  |  State: /workspace/                                  |    |
|  |    +-- features.json      (task state)              |    |
|  |    +-- ralph-progress.txt (iteration log)          |    |
|  |    +-- .git/              (version control)         |    |
|  +-----------------------------------------------------+    |
+-------------------------------------------------------------+
```

### 1.2 Current Capabilities

| Feature | Status | Implementation |
|---------|--------|----------------|
| Container isolation | Done | Docker + non-root user |
| Network whitelisting | Done | iptables/ipset in init-firewall.sh |
| Feature-based tasks | Done | features.json with verification commands |
| Git-based persistence | Done | Commits after each feature |
| Circuit breaker | Done | 3 iterations without git changes |
| Resume sessions | Done | --branch flag for existing PRs |
| PR creation | Done | gh pr create on first push |

### 1.3 Current Limitations

| Limitation | Impact | Priority |
|------------|--------|----------|
| No task dependencies | Claude guesses order, may attempt blocked tasks | P0 |
| No validation layer | Trusts Claude's passes:true without verification | P0 |
| Single worker only | Cannot parallelize independent tasks | P1 |
| Basic circuit breaker | Only checks git diff, misses semantic stuck states | P1 |
| No rate limiting | Could hit API limits on long sessions | P2 |
| Minimal observability | Console logs only, no metrics/dashboards | P2 |

---

## 2. Design Principles

### 2.1 Core Tenets

Building on Geoffrey Huntley's Ralph Wiggum principles, we establish:

1. **Pure Ralph** - Fresh context each iteration, filesystem/git as sole memory
2. **Trust but Verify** - Every claim of completion faces adversarial validation
3. **Fail Fast, Recover Gracefully** - Detect stuck states early, preserve work
4. **Isolation by Default** - Containers are ephemeral, git is durable
5. **Observable Everything** - If it happened, we can see it

### 2.2 Non-Goals

- **IDE integration** - Ralph is headless CLI tooling
- **Real-time collaboration** - Workers don't share state except via git
- **Cloud hosting** - Local Docker execution only (for now)
- **Non-Claude models** - Hardcoded to Claude Code CLI

---

## 3. System Architecture

### 3.1 Ralph 2.0 High-Level Architecture

```
+---------------------------------------------------------------------+
|                         RALPH 2.0 ORCHESTRATOR                       |
|                                                                       |
|  +---------------------------------------------------------------+  |
|  |                      COORDINATOR                               |  |
|  |  +-----------+  +-----------+  +-------------------+          |  |
|  |  |  Beads    |  |  Worker   |  |  Session          |          |  |
|  |  |  Manager  |  |  Pool     |  |  Manager          |          |  |
|  |  +-----+-----+  +-----+-----+  +---------+---------+          |  |
|  |        |              |                  |                     |  |
|  |        v              v                  v                     |  |
|  |  +---------------------------------------------------------+  |  |
|  |  |                   EVENT LOOP                             |  |  |
|  |  |  1. Get ready beads (bd ready)                          |  |  |
|  |  |  2. Assign to available workers                         |  |  |
|  |  |  3. Monitor worker health                               |  |  |
|  |  |  4. Process validation results                          |  |  |
|  |  |  5. Handle conflicts and retries                        |  |  |
|  |  +---------------------------------------------------------+  |  |
|  +---------------------------------------------------------------+  |
|                                                                       |
|  +---------------------------------------------------------------+  |
|  |                       WORKER POOL                              |  |
|  |                                                                 |  |
|  |  +-----------+  +-----------+  +-----------+                   |  |
|  |  |  Worker 1 |  |  Worker 2 |  |  Worker N |                   |  |
|  |  |  (Impl)   |  |  (Impl)   |  | (Validator)|                  |  |
|  |  |           |  |           |  |           |                   |  |
|  |  | +-------+ |  | +-------+ |  | +-------+ |                   |  |
|  |  | |Container| |  | |Container| |  | |Container| |             |  |
|  |  | |  + FW  | |  | |  + FW  | |  | |  + FW  | |                |  |
|  |  | +-------+ |  | +-------+ |  | +-------+ |                   |  |
|  |  +-----------+  +-----------+  +-----------+                   |  |
|  +---------------------------------------------------------------+  |
|                                                                       |
|  +---------------------------------------------------------------+  |
|  |                    VALIDATION PIPELINE                         |  |
|  |                                                                 |  |
|  |  +-------+  +----------+  +---------+  +---------------+       |  |
|  |  |Layer 1|->| Layer 2  |->| Layer 3 |->|   Layer 4     |       |  |
|  |  |Auto   |  |Structural|  |Semantic |  | Integration   |       |  |
|  |  |Checks |  |  Checks  |  |Validator|  | (CI on merge) |       |  |
|  |  +-------+  +----------+  +---------+  +---------------+       |  |
|  +---------------------------------------------------------------+  |
|                                                                       |
|  +---------------------------------------------------------------+  |
|  |                    OBSERVABILITY                               |  |
|  |  +--------+  +----------+  +--------+  +------------+          |  |
|  |  |Metrics |  |  Logs    |  |Session |  | Dashboard  |          |  |
|  |  |Collector| | Aggregator| |Recorder|  | (optional) |          |  |
|  |  +--------+  +----------+  +--------+  +------------+          |  |
|  +---------------------------------------------------------------+  |
+---------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility | State Owned |
|-----------|---------------|-------------|
| **Coordinator** | Assigns beads, monitors workers, handles conflicts | Worker registry, bead assignments |
| **Beads Manager** | Interfaces with `bd` CLI, tracks dependencies | Cached bead graph |
| **Worker Pool** | Manages container lifecycle | Container IDs, health status |
| **Session Manager** | Git branch coordination, conflict resolution | Branch mappings |
| **Validation Pipeline** | Multi-layer verification | Validation reports |
| **Observability** | Metrics, logs, session recording | Session artifacts |

---

## 4. Component Deep Dives

### 4.1 Beads Integration

#### 4.1.1 Why Beads Over features.json

[Beads](https://github.com/steveyegge/beads) is a git-backed, dependency-aware task tracker optimized for AI agents, created by Steve Yegge.

| Aspect | features.json (current) | Beads |
|--------|------------------------|-------|
| Dependencies | None (flat list) | Graph with blockers |
| Ready tasks | Claude guesses | `bd ready` returns unblocked |
| Subtask discovery | Manual add to JSON | `bd create --parent` |
| Context compaction | None | Semantic summarization |
| Conflict handling | None | Hash-based IDs, JSONL merge |

#### 4.1.2 Beads Data Flow

```
+-------------------------------------------------------------+
|                      BEADS WORKFLOW                          |
|                                                              |
|  Initial State:                                              |
|  features.json --migrate--> .beads/beads.jsonl              |
|                                                              |
|  Each Iteration:                                             |
|  +------------------------------------------------------+   |
|  |  1. Orchestrator: bd ready --json                     |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  [{"id":"bd-a1b2","title":"Setup auth",...}, ...]    |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  2. Assign bead to worker                            |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  3. Worker: bd start bd-a1b2                         |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  4. Worker: (implement, test, verify)                |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  5. Worker: bd close bd-a1b2 --message "Done"        |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  6. Worker: git add .beads/ && git commit && push    |   |
|  |         |                                             |   |
|  |         v                                             |   |
|  |  7. Orchestrator: git pull (refresh bead state)      |   |
|  +------------------------------------------------------+   |
|                                                              |
|  Subtask Discovery:                                          |
|  Worker finds: "Auth needs DB first"                        |
|  Worker: bd create "Setup database" --blocker bd-a1b2       |
|  (New bead bd-c3d4 now blocks bd-a1b2)                      |
|  Worker: bd skip bd-a1b2 --reason "blocked by bd-c3d4"      |
+-------------------------------------------------------------+
```

#### 4.1.3 Migration Strategy

```typescript
// src/beads/migration.ts

interface FeatureToBeadMapping {
  featureId: string;
  beadId: string;
  migrated: boolean;
}

async function migrateFeaturesToBeads(
  featuresPath: string,
  containerName: string
): Promise<FeatureToBeadMapping[]> {
  // 1. Initialize beads if not present
  await exec(containerName, 'bd init');

  // 2. Read features.json
  const features = await readFeatures(containerName, featuresPath);

  // 3. Create beads for each feature (preserve order as implicit deps)
  const mappings: FeatureToBeadMapping[] = [];
  let previousBeadId: string | null = null;

  for (const feature of features) {
    const beadId = await exec(containerName,
      `bd create "${feature.description}" --json`
    );

    // If previous bead exists, make this depend on it
    if (previousBeadId) {
      await exec(containerName, `bd dep add ${beadId} ${previousBeadId}`);
    }

    // Add verification as acceptance criteria
    await exec(containerName,
      `bd update ${beadId} --acceptance "Verify: ${feature.verification}"`
    );

    // If already passing, close it
    if (feature.passes) {
      await exec(containerName, `bd close ${beadId} --message "Pre-migrated"`);
    }

    mappings.push({ featureId: feature.id, beadId, migrated: true });
    previousBeadId = beadId;
  }

  return mappings;
}
```

### 4.2 Validation Pipeline

#### 4.2.1 Four-Layer Architecture

```
+---------------------------------------------------------------+
|                    VALIDATION PIPELINE                         |
|                                                                 |
|  +---------------------------------------------------------+  |
|  | LAYER 1: AUTOMATED CHECKS                                |  |
|  | Trigger: After worker marks bead complete                |  |
|  | Executor: Orchestrator (in-container)                    |  |
|  |                                                          |  |
|  | Checks:                                                  |  |
|  |  - Verification command exits 0                         |  |
|  |  - Type check passes (if configured)                    |  |
|  |  - Lint passes (if configured)                          |  |
|  |  - Existing tests pass                                  |  |
|  |                                                          |  |
|  | Latency: ~30s     Cost: Free     Pass Rate: ~95%        |  |
|  +----------------------------+-----------------------------+  |
|                               | PASS                           |
|                               v                                |
|  +---------------------------------------------------------+  |
|  | LAYER 2: STRUCTURAL CHECKS                               |  |
|  | Trigger: Layer 1 passes                                  |  |
|  | Executor: Orchestrator (in-container)                    |  |
|  |                                                          |  |
|  | Checks:                                                  |  |
|  |  - Diff size reasonable (< 500 lines per bead)          |  |
|  |  - No secrets in diff (grep for patterns)               |  |
|  |  - No debug code (console.log, TODO, FIXME)             |  |
|  |  - No obvious anti-patterns (eval, innerHTML)           |  |
|  |  - Test coverage for new code (if coverage tool exists) |  |
|  |                                                          |  |
|  | Latency: ~10s     Cost: Free     Pass Rate: ~90%        |  |
|  +----------------------------+-----------------------------+  |
|                               | PASS                           |
|                               v                                |
|  +---------------------------------------------------------+  |
|  | LAYER 3: SEMANTIC VALIDATION (VALIDATOR AGENT)          |  |
|  | Trigger: Layer 2 passes                                  |  |
|  | Executor: Dedicated validator container OR same container|  |
|  |                                                          |  |
|  | Process:                                                 |  |
|  |  1. Read diff and bead acceptance criteria              |  |
|  |  2. Review implementation for correctness               |  |
|  |  3. Check edge cases and error handling                 |  |
|  |  4. Security review (SQLi, XSS, auth bypass)            |  |
|  |  5. Write validation report to .ralph/validations/      |  |
|  |  6. Return APPROVED or NEEDS_WORK                       |  |
|  |                                                          |  |
|  | Latency: ~2min    Cost: ~$0.10    Pass Rate: ~80%       |  |
|  +----------------------------+-----------------------------+  |
|                               | APPROVED                       |
|                               v                                |
|  +---------------------------------------------------------+  |
|  | LAYER 4: INTEGRATION VALIDATION                          |  |
|  | Trigger: PR merge OR --full-validation flag              |  |
|  | Executor: CI system (GitHub Actions)                     |  |
|  |                                                          |  |
|  | Checks:                                                  |  |
|  |  - Full CI pipeline on merged code                      |  |
|  |  - E2E tests (if available)                             |  |
|  |  - Performance regression (if benchmarks exist)         |  |
|  |  - Cross-browser testing (for frontend)                 |  |
|  |                                                          |  |
|  | Latency: ~5min    Cost: CI minutes   Pass Rate: ~95%    |  |
|  +---------------------------------------------------------+  |
+---------------------------------------------------------------+
```

#### 4.2.2 Validator Agent Prompt

```markdown
# Validator Agent Instructions

You are a SKEPTICAL senior engineer reviewing AI-generated code. Your job is
to FIND PROBLEMS, not approve quickly. The implementer has already run tests
and marked this complete - your role is adversarial verification.

## Context

**Bead ID**: {{bead_id}}
**Title**: {{bead_title}}
**Description**: {{bead_description}}
**Acceptance Criteria**: {{acceptance_criteria}}
**Verification Command**: {{verification_command}}
**Implementer Notes**: {{implementer_notes}}

## Your Review Process

### Step 1: Understand the Requirement
Read the acceptance criteria carefully. What EXACTLY should this implementation do?
List edge cases the acceptance criteria implies.

### Step 2: Review the Diff
```bash
git diff main...HEAD -- {{affected_files}}
```
For each changed file:
- Does this change align with the requirement?
- Are there unnecessary changes (scope creep)?
- Is the code readable and maintainable?

### Step 3: Run Verification Yourself
```bash
{{verification_command}}
```
Did it actually pass? Or pass vacuously (trivial test)?

### Step 4: Adversarial Testing
Try to break it:
- Invalid inputs
- Boundary conditions
- Concurrent access (if applicable)
- Empty/null/undefined values
- Very large inputs

### Step 5: Security Review
Check for:
- [ ] SQL injection (parameterized queries?)
- [ ] XSS (proper escaping?)
- [ ] Command injection (shell escaping?)
- [ ] Path traversal (validate paths?)
- [ ] Auth bypass (proper checks?)
- [ ] Data exposure (no secrets in logs?)
- [ ] CSRF (tokens present?)

### Step 6: Quality Assessment
- Is this the RIGHT solution or a hack?
- Would you approve this in a code review from a human?
- Any obvious improvements the implementer missed?

## Output

Write your report to: `.ralph/validations/{{bead_id}}.md`

## Critical Rules

1. **Default to NEEDS_WORK** if uncertain
2. **Never approve code you don't understand**
3. **Check acceptance criteria literally** - not "close enough"
4. **Passing tests != correct implementation** - tests may be wrong
5. **Your reputation is on the line** - don't rubber-stamp
```

#### 4.2.3 Validation Failure Handling

```typescript
// src/validation/pipeline.ts

interface ValidationResult {
  beadId: string;
  layer: 1 | 2 | 3 | 4;
  verdict: 'APPROVED' | 'NEEDS_WORK';
  issues: ValidationIssue[];
  report?: string;  // Path to full report
}

async function handleValidationFailure(
  containerName: string,
  beadId: string,
  result: ValidationResult
): Promise<void> {
  // 1. Revert bead status
  await exec(containerName, `bd reopen ${beadId} --reason "Validation failed"`);

  // 2. Create remediation bead if critical issues
  const criticalIssues = result.issues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > 0) {
    for (const issue of criticalIssues) {
      await exec(containerName,
        `bd create "Fix: ${issue.title}" --blocker ${beadId}`
      );
    }
  }

  // 3. Write feedback for next iteration
  const feedback = `
VALIDATION FAILED: ${beadId}
Layer: ${result.layer}
Issues requiring fix:
${result.issues.map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n')}

Full report: ${result.report}

NEXT ITERATION MUST address these issues before re-attempting.
`;

  await appendToProgress(containerName, feedback);

  // 4. Commit the revert + feedback
  await exec(containerName, 'git add -A && git commit -m "Revert: validation failed" && git push');
}
```

### 4.3 Multi-Worker Orchestration

#### 4.3.1 Worker Lifecycle

```
+------------------------------------------------------------------+
|                      WORKER LIFECYCLE                             |
|                                                                    |
|  +---------------------------------------------------------+     |
|  |                        IDLE                              |     |
|  |  - No bead assigned                                     |     |
|  |  - Container running, waiting for work                  |     |
|  +----------------------------+----------------------------+     |
|                               | assign(bead)                      |
|                               v                                   |
|  +---------------------------------------------------------+     |
|  |                       WORKING                            |     |
|  |  - Bead locked to this worker                           |     |
|  |  - Claude running inside container                      |     |
|  |  - Heartbeat every 30s                                  |     |
|  +-----------------------+-------------------+-------------+     |
|                          | success           | failure/timeout   |
|                          v                   v                   |
|  +------------------------+  +-----------------------------+     |
|  |        VALIDATING      |  |          FAILED             |     |
|  |  - Bead marked complete|  |  - Log failure reason       |     |
|  |  - Running validation  |  |  - Release bead lock        |     |
|  |    pipeline            |  |  - Increment retry counter  |     |
|  +------------+-----------+  +--------------+--------------+     |
|               | approved/rejected           |                     |
|               v                             |                     |
|  +---------------------------------------------------------+     |
|  |                        IDLE                              | <--+
|  |  - Ready for next bead                                  |
|  +---------------------------------------------------------+
+------------------------------------------------------------------+
```

#### 4.3.2 Coordinator Logic

```typescript
// src/coordinator/index.ts

interface WorkerState {
  id: string;
  containerId: string;
  status: 'idle' | 'working' | 'validating' | 'failed';
  currentBead: string | null;
  lastHeartbeat: Date;
  consecutiveFailures: number;
}

interface CoordinatorConfig {
  maxWorkers: number;
  validatorWorkerRatio: number;  // e.g., 1 validator per 3 implementers
  maxRetries: number;
  heartbeatTimeout: number;
}

class Coordinator {
  private workers: Map<string, WorkerState> = new Map();
  private beadAssignments: Map<string, string> = new Map();  // bead -> worker

  async runLoop() {
    while (true) {
      // 1. Health check workers
      await this.checkWorkerHealth();

      // 2. Get ready beads
      const readyBeads = await this.beadsManager.getReady();

      // 3. Check termination conditions
      if (readyBeads.length === 0) {
        if (await this.allBeadsClosed()) {
          console.log('All beads complete!');
          break;
        }
        // Stuck: no ready but not done
        await this.handleStuckState();
        continue;
      }

      // 4. Assign beads to idle workers
      const idleWorkers = this.getIdleWorkers();
      for (const bead of readyBeads) {
        if (this.beadAssignments.has(bead.id)) continue;  // Already assigned

        const worker = idleWorkers.shift();
        if (!worker) break;  // No more idle workers

        await this.assignBead(worker.id, bead.id);
      }

      // 5. Process completed work
      await this.processCompletions();

      // 6. Short sleep to avoid busy loop
      await sleep(1000);
    }
  }

  private async assignBead(workerId: string, beadId: string) {
    const worker = this.workers.get(workerId)!;

    // Lock bead to worker
    this.beadAssignments.set(beadId, workerId);
    worker.status = 'working';
    worker.currentBead = beadId;

    // Inject bead-specific prompt
    const prompt = await this.buildBeadPrompt(beadId);

    // Run Claude in worker container (non-blocking)
    this.spawnClaudeInWorker(worker.containerId, prompt);
  }
}
```

#### 4.3.3 Git Conflict Resolution

```typescript
// src/coordinator/git-sync.ts

interface ConflictResolution {
  strategy: 'rebase' | 'merge' | 'abort';
  conflictingFiles: string[];
  resolution: 'auto' | 'manual';
}

async function syncWorkerBranch(
  workerContainer: string,
  mainBranch: string,
  workerBranch: string
): Promise<ConflictResolution> {
  // 1. Fetch latest main
  await exec(workerContainer, `git fetch origin ${mainBranch}`);

  // 2. Attempt rebase
  const rebaseResult = await exec(workerContainer,
    `git rebase origin/${mainBranch}`,
    { throwOnError: false }
  );

  if (rebaseResult.exitCode === 0) {
    return { strategy: 'rebase', conflictingFiles: [], resolution: 'auto' };
  }

  // 3. Check conflict type
  const conflictFiles = await exec(workerContainer,
    'git diff --name-only --diff-filter=U'
  );

  // 4. If only .beads/ conflicts, auto-resolve (ours wins for in-progress)
  const beadsConflicts = conflictFiles.filter(f => f.startsWith('.beads/'));
  const codeConflicts = conflictFiles.filter(f => !f.startsWith('.beads/'));

  if (codeConflicts.length === 0) {
    // Beads-only conflict: take ours (worker's changes)
    await exec(workerContainer, 'git checkout --ours .beads/');
    await exec(workerContainer, 'git add .beads/');
    await exec(workerContainer, 'git rebase --continue');

    return {
      strategy: 'rebase',
      conflictingFiles: beadsConflicts,
      resolution: 'auto'
    };
  }

  // 5. Code conflict: abort and reassign bead
  await exec(workerContainer, 'git rebase --abort');

  return {
    strategy: 'abort',
    conflictingFiles: codeConflicts,
    resolution: 'manual'  // Coordinator will reassign
  };
}
```

### 4.4 Enhanced Stuck Detection

#### 4.4.1 Multi-Signal Detection

```typescript
// src/stuck/detector.ts

interface StuckSignals {
  noGitDiff: number;           // Iterations without git changes
  sameBeadAttempts: number;    // Same bead failing repeatedly
  sameErrorPattern: number;    // Same error message repeating
  outputDecline: number;       // Output getting shorter each iteration
  progressKeywords: string[];  // "BLOCKED", "cannot", "stuck" in progress log
  validationLoops: number;     // validate->fail->fix->validate cycle
}

interface StuckDecision {
  isStuck: boolean;
  reason: string;
  action: 'continue' | 'skip_bead' | 'escalate' | 'abort';
}

function analyzeStuckState(signals: StuckSignals): StuckDecision {
  // Hard limits (circuit breaker)
  if (signals.noGitDiff >= 5) {
    return {
      isStuck: true,
      reason: 'No git changes for 5+ iterations',
      action: 'abort'
    };
  }

  if (signals.sameBeadAttempts >= 3) {
    return {
      isStuck: true,
      reason: `Bead failed ${signals.sameBeadAttempts} times`,
      action: 'skip_bead'
    };
  }

  if (signals.sameErrorPattern >= 3) {
    return {
      isStuck: true,
      reason: 'Same error repeated 3+ times',
      action: 'escalate'  // Maybe needs human intervention
    };
  }

  // Soft signals (warn but continue)
  if (signals.validationLoops >= 2) {
    // Log warning but allow continued attempts
    console.warn('Validation loop detected - implementer struggling');
  }

  if (signals.progressKeywords.includes('BLOCKED')) {
    // Check if bead has blockers we can resolve
    return {
      isStuck: false,
      reason: 'Bead has known blockers',
      action: 'skip_bead'
    };
  }

  return { isStuck: false, reason: '', action: 'continue' };
}
```

### 4.5 Observability

#### 4.5.1 Session Structure

```
ralph-sessions/
+-- 2026-01-09-abc123/
    +-- config.json              # Session configuration
    |   {
    |     "startTime": "...",
    |     "workers": 3,
    |     "gitRepo": "...",
    |     "branch": "ralph/abc123"
    |   }
    |
    +-- beads-snapshots/         # .beads/ state at each commit
    |   +-- commit-abc1234.jsonl
    |   +-- commit-def5678.jsonl
    |
    +-- workers/
    |   +-- worker-1/
    |   |   +-- iterations.jsonl # Per-iteration data
    |   |   |   {"iteration":1,"bead":"bd-a1","result":"success",...}
    |   |   +-- transcript.log   # Raw Claude I/O
    |   |   +-- metrics.json     # Timing, tokens, etc.
    |   |
    |   +-- worker-2/
    |       +-- ...
    |
    +-- validations/
    |   +-- bd-a1b2.md           # Validation report for bead
    |   +-- bd-c3d4.md
    |
    +-- conflicts/               # Git conflict records
    |   +-- conflict-001.json
    |
    +-- metrics.json             # Aggregate session metrics
    |   {
    |     "beadsTotal": 12,
    |     "beadsCompleted": 8,
    |     "beadsFailed": 1,
    |     "totalIterations": 24,
    |     "totalDuration": "2h 15m",
    |     "validationPassRate": 0.82
    |   }
    |
    +-- report.md                # Auto-generated summary
```

#### 4.5.2 Metrics Collection

```typescript
// src/observability/metrics.ts

interface IterationMetrics {
  iteration: number;
  workerId: string;
  beadId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  claudeTokensIn: number;
  claudeTokensOut: number;
  result: 'success' | 'failure' | 'timeout' | 'validation_failed';
  gitCommit?: string;
  validationLayers: number[];  // Which layers passed [1,2,3]
}

interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  beadsTotal: number;
  beadsCompleted: number;
  beadsFailed: number;
  beadsSkipped: number;
  totalIterations: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCost: number;  // Based on token counts
  validationPassRate: number;
  averageIterationDuration: number;
  stuckDetections: number;
  gitConflicts: number;
}

class MetricsCollector {
  private sessionMetrics: SessionMetrics;
  private iterationBuffer: IterationMetrics[] = [];

  recordIteration(metrics: IterationMetrics) {
    this.iterationBuffer.push(metrics);
    this.updateAggregates(metrics);

    // Flush to disk periodically
    if (this.iterationBuffer.length >= 10) {
      this.flushToDisk();
    }
  }

  generateReport(): string {
    return `# Ralph Session Report: ${this.sessionMetrics.sessionId}

## Summary
- **Duration**: ${formatDuration(this.sessionMetrics.endTime - this.sessionMetrics.startTime)}
- **Beads**: ${this.sessionMetrics.beadsCompleted}/${this.sessionMetrics.beadsTotal} completed
- **Iterations**: ${this.sessionMetrics.totalIterations}
- **Estimated Cost**: $${this.sessionMetrics.estimatedCost.toFixed(2)}

## Validation
- Pass rate: ${(this.sessionMetrics.validationPassRate * 100).toFixed(1)}%

## Issues
- Stuck detections: ${this.sessionMetrics.stuckDetections}
- Git conflicts: ${this.sessionMetrics.gitConflicts}
- Beads skipped: ${this.sessionMetrics.beadsSkipped}
`;
  }
}
```

---

## 5. Data Models

### 5.1 Core Types

```typescript
// src/types/index.ts

// === Beads ===

interface Bead {
  id: string;           // Hash-based: bd-a1b2c3
  title: string;
  description: string;
  acceptance?: string;
  verification?: string;  // Command that must exit 0
  status: 'open' | 'in_progress' | 'closed';
  parent?: string;       // Parent bead ID
  blockedBy: string[];   // Bead IDs that must complete first
  createdAt: Date;
  closedAt?: Date;
  closedBy?: string;     // Worker ID or "manual"
}

// === Workers ===

interface Worker {
  id: string;
  containerId: string;
  containerName: string;
  branch: string;
  role: 'implementer' | 'validator';
  status: WorkerStatus;
  currentBead?: string;
  metrics: WorkerMetrics;
}

type WorkerStatus =
  | { state: 'idle' }
  | { state: 'working'; beadId: string; startedAt: Date }
  | { state: 'validating'; beadId: string }
  | { state: 'failed'; reason: string }
  | { state: 'terminated' };

// === Validation ===

interface ValidationReport {
  beadId: string;
  timestamp: Date;
  verdict: 'APPROVED' | 'NEEDS_WORK';
  layer: 1 | 2 | 3 | 4;
  issues: ValidationIssue[];
  acceptanceCriteriaChecks: AcceptanceCheck[];
  securityReview: SecurityReview;
  verificationResult: VerificationResult;
}

// === Session ===

interface Session {
  id: string;
  startTime: Date;
  endTime?: Date;
  config: SessionConfig;
  workers: Worker[];
  beadsMigrated: boolean;
  status: 'running' | 'completed' | 'failed' | 'stuck';
}
```

### 5.2 Configuration Schema

```typescript
// ralph.config.ts (project configuration)

export interface RalphConfig {
  // Task source
  source: 'features' | 'beads';
  featuresPath?: string;  // If source=features

  // Parallelism
  workers: {
    max: number;
    validatorRatio: number;  // 1 validator per N implementers
  };

  // Timeouts
  timeouts: {
    iteration: number;      // ms per Claude invocation
    validation: number;     // ms for validator agent
    heartbeat: number;      // ms between health checks
  };

  // Validation
  validation: {
    layers: (1 | 2 | 3 | 4)[];
    layer2: {
      maxDiffLines: number;
      secretPatterns: string[];
      debugPatterns: string[];
    };
    layer3: {
      enabled: boolean;
      promptPath?: string;  // Custom validator prompt
    };
  };

  // Stuck detection
  stuckDetection: {
    noChangeLimit: number;
    sameBeadLimit: number;
    sameErrorLimit: number;
  };

  // Observability
  observability: {
    sessionDir: string;
    metricsEnabled: boolean;
    transcriptEnabled: boolean;
  };
}
```

---

## 6. API Contracts

### 6.1 Internal APIs

```typescript
// === Beads Manager ===

interface BeadsManager {
  init(): Promise<void>;
  getReady(): Promise<Bead[]>;
  getAll(): Promise<Bead[]>;
  get(id: string): Promise<Bead | null>;
  create(title: string, options?: CreateBeadOptions): Promise<Bead>;
  close(id: string, message: string): Promise<void>;
  reopen(id: string, reason: string): Promise<void>;
  addDependency(beadId: string, blockedBy: string): Promise<void>;
  migrateFromFeatures(featuresPath: string): Promise<void>;
}

// === Worker Pool ===

interface WorkerPool {
  spawn(count: number): Promise<Worker[]>;
  terminate(workerId: string): Promise<void>;
  terminateAll(): Promise<void>;
  getIdle(): Worker[];
  getAll(): Worker[];
  assignBead(workerId: string, beadId: string): Promise<void>;
  releaseBead(workerId: string): Promise<void>;
  checkHealth(workerId: string): Promise<boolean>;
}

// === Validation Pipeline ===

interface ValidationPipeline {
  validate(beadId: string, options?: ValidationOptions): Promise<ValidationResult>;
  runLayer1(beadId: string): Promise<LayerResult>;
  runLayer2(beadId: string): Promise<LayerResult>;
  runLayer3(beadId: string): Promise<LayerResult>;
  getReport(beadId: string): Promise<ValidationReport | null>;
}
```

### 6.2 CLI Interface

```bash
# Basic usage
bun ralph.ts [features.json]

# With options
bun ralph.ts features.json \
  --workers 3 \
  --branch my-feature \
  --config ralph.config.ts \
  --validation-layers 1,2,3 \
  --once \
  --verbose

# Commands
bun ralph.ts init           # Create ralph.config.ts
bun ralph.ts migrate        # Migrate features.json to beads
bun ralph.ts status         # Show current session status
bun ralph.ts workers        # List worker status
bun ralph.ts validate bd-123  # Run validation on specific bead
bun ralph.ts report         # Generate session report
```

---

## 7. Security Model

### 7.1 Threat Model

| Threat | Mitigation | Residual Risk |
|--------|------------|---------------|
| Code exfiltration | Network whitelist blocks unauthorized endpoints | API calls could encode data |
| Malicious deps | npm registry whitelisted, no pip/etc | Supply chain attacks via npm |
| Container escape | Non-root user, no privileged mode | Docker CVEs |
| Secrets in code | Layer 2 validation checks patterns | Obfuscated secrets |
| Resource exhaustion | Timeout per iteration, max iterations | Very slow attacks |

### 7.2 Network Rules

```bash
# Allowed outbound (from init-firewall.sh)
api.anthropic.com     # Claude API
registry.npmjs.org    # npm packages
*.github.com          # GitHub (code, API, packages)
sentry.io             # Claude CLI telemetry
statsig.anthropic.com # Claude CLI feature flags
statsig.com           # Feature flags

# All other outbound: REJECT
```

### 7.3 Container Hardening

```dockerfile
# Non-root user (required for --dangerously-skip-permissions)
USER node

# Read-only where possible
-v ${HOME}/.ssh:/home/node/.ssh:ro
-v ${HOME}/.gitconfig:/home/node/.gitconfig:ro

# Minimal capabilities
--cap-add=NET_ADMIN  # Only for iptables, could be dropped post-init
```

---

## 8. Migration Path

### 8.1 Phase 0: Preparation (Current -> Ready)

1. **Add test suite** for existing ralph.ts
   - Unit tests for src/container.ts pure functions
   - Integration tests with mock Docker

2. **Extract remaining logic** from ralph.ts to src/
   - src/session.ts (session lifecycle)
   - src/prompt.ts (prompt building)
   - src/git.ts (git operations)

3. **Add configuration file support**
   - Parse ralph.config.ts if present
   - Merge with CLI args

### 8.2 Phase 1: Validation Pipeline

1. **Layer 1**: Add automated checks in orchestrator
2. **Layer 2**: Add structural checks (grep-based)
3. **Layer 3**: Add validator agent prompt + invocation
4. **Wire into main loop**: Validate before accepting passes:true

### 8.3 Phase 2: Beads Integration

1. **Add beads as dependency** (npm install beads)
2. **Create migration script** (features.json -> .beads/)
3. **Update instructions template** for bd commands
4. **Replace getRemainingFeatures** with BeadsManager.getReady

### 8.4 Phase 3: Multi-Worker

1. **Extract worker logic** from ralph.ts
2. **Build Coordinator** with worker pool
3. **Add git sync** for conflict resolution
4. **Test with 2 workers** before scaling

### 8.5 Phase 4: Observability

1. **Add session directory structure**
2. **Implement MetricsCollector**
3. **Add report generation**
4. **Optional: tmux dashboard**

---

## 9. Implementation Phases

### 9.1 MVP Scope

| Component | MVP | Full |
|-----------|-----|------|
| Validation | Layers 1-3 | + Layer 4 CI integration |
| Beads | Basic (ready, close) | + Subtasks, compaction |
| Workers | 1-2 workers | 3+ with dynamic scaling |
| Observability | Metrics + report | + Dashboard |
| Stuck detection | Git diff + same-bead | + Semantic analysis |

### 9.2 Feature Flags

```typescript
// ralph.config.ts
{
  experiments: {
    multiWorker: false,      // Phase 3
    layer4Validation: false, // CI integration
    semanticStuck: false,    // ML-based stuck detection
    dashboard: false,        // Web UI
  }
}
```

### 9.3 Success Criteria

| Phase | Success Criteria |
|-------|-----------------|
| 1 (Validation) | 20% reduction in bugs reaching main branch |
| 2 (Beads) | No more dependency-ordering issues |
| 3 (Multi-Worker) | 2x throughput on 10+ bead projects |
| 4 (Observability) | < 5min to diagnose session failures |

---

## 10. Open Questions

### 10.1 Technical

1. **Beads vs native enhancement**: Should we create our own features.json enhancement if Beads has issues?

2. **Validator container**: Same container (cheaper, shares context) or separate (cleaner isolation)?

3. **Git strategy**: Rebase (cleaner history) or merge (safer for conflicts)?

4. **Rate limiting**: Anthropic API has limits - should we track and throttle?

### 10.2 Process

1. **When to validate**: Every bead? Only on user request? Configurable?

2. **Human escalation**: How do we notify when stuck detection triggers?

3. **Partial sessions**: Can we resume a multi-worker session?

### 10.3 Cost

1. **Validator cost**: Layer 3 adds ~$0.10/bead. Budget implications for large projects?

2. **Token optimization**: Can we summarize context to reduce costs?

---

## Appendix A: Reference Implementations

| Project | Description | Link |
|---------|-------------|------|
| **Geoffrey Huntley's Ralph** | Original Ralph Wiggum Loop concept and philosophy | [ghuntley.com/ralph/](https://ghuntley.com/ralph/) |
| **frankbria/ralph-claude-code** | Bash-based orchestrator with circuit breaker patterns | [GitHub](https://github.com/frankbria/ralph-claude-code) |
| **steveyegge/beads** | Git-backed task graph for AI agents | [GitHub](https://github.com/steveyegge/beads) |
| **anthropics/claude-code/.devcontainer** | Official container + firewall reference | [GitHub](https://github.com/anthropics/claude-code) |
| **How to Build a Coding Agent** | Geoffrey Huntley's free workshop | [ghuntley.com/agent/](https://ghuntley.com/agent/) |

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Bead** | Single atomic task with dependencies (replaces "feature") |
| **Worker** | Docker container running Claude for a specific bead |
| **Coordinator** | Orchestrator that assigns beads to workers |
| **Validator** | Skeptical agent that reviews implementer work |
| **Layer** | Stage in validation pipeline (1=automated, 2=structural, 3=semantic, 4=CI) |
| **Pure Ralph** | External orchestration with fresh context per iteration (vs. plugin-based) |
| **Ralph Wiggum Loop** | Technique created by Geoffrey Huntley for autonomous AI coding |

## Appendix C: Acknowledgments

This architecture builds upon the foundational work of:

- **Geoffrey Huntley** - Creator of the Ralph Wiggum Loop technique. See [ghuntley.com/ralph/](https://ghuntley.com/ralph/) for the original concept and philosophy.
- **Steve Yegge** - Creator of Beads, the git-backed task tracker for AI agents.
- **Anthropic** - For Claude Code CLI and the devcontainer firewall reference.

---

*Document Version: 1.0.0-draft*
*Last Updated: January 9, 2026*
