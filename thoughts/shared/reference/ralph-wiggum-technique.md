# The Ralph Wiggum Technique: Comprehensive Reference

**Date**: 2026-01-13
**Author**: Claude
**Source**: https://github.com/ghuntley/how-to-ralph-wiggum
**Status**: Reference Document

---

## Table of Contents

1. [Overview](#overview)
2. [Core Philosophy](#core-philosophy)
3. [Three-Phase Architecture](#three-phase-architecture)
4. [The Loop Mechanism](#the-loop-mechanism)
5. [File Structure](#file-structure)
6. [Prompt Templates](#prompt-templates)
7. [Key Principles](#key-principles)
8. [Integration with Ralph Orchestrator](#integration-with-ralph-orchestrator)
9. [Implementation Guide](#implementation-guide)
10. [Advanced Patterns](#advanced-patterns)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The **Ralph Wiggum Technique** is an AI development methodology created by Geoffrey Huntley that leverages Claude (or similar LLMs) to autonomously implement software features through iterative loops. The technique is designed to drastically reduce development costs while maintaining code quality through:

- **Deterministic planning** - Explicit file context creates predictable starting state
- **Automated testing** - Backpressure from tests/builds enforces quality
- **Context optimization** - One task per iteration maximizes "smart zone" utilization
- **Eventual consistency** - Trust the LLM to self-correct through iteration

### Why "Ralph Wiggum"?

The name references the Simpsons character known for saying things that seem nonsensical but occasionally contain wisdom. Similarly, AI coding agents may take unexpected paths but eventually arrive at working solutions through iteration.

---

## Core Philosophy

### The Four Pillars

1. **Context Is Everything**
   - 200K+ advertised tokens = ~176K truly usable
   - Only 40-60% of context operates in the "smart zone"
   - Spawn subagents liberally; treat each ~156kb as garbage-collected memory
   - Main context is precious; delegate expensive work to subagents

2. **Steering Ralph**
   - **Upstream steering**: Deterministic file setup (specs, code patterns, utilities)
   - **Downstream steering**: Backpressure from failing tests, typechecks, and lints
   - The agent discovers patterns from `src/lib` utilities and existing implementations

3. **Let Ralph Ralph**
   - Trust the LLM to self-identify, self-correct, and improve
   - Eventual consistency achieved via iteration, not prescriptive control
   - Don't micromanage; tune the environment instead

4. **Move Outside the Loop**
   - Human responsibility shifts from execution to observation
   - Watch patterns emerge, identify failure modes
   - Add guardrails reactively, not prescriptively

### The Plan Is Disposable

> "I have deleted the TODO list multiple times" — Geoff Huntley

The implementation plan can be regenerated at any time for the cost of one planning loop. This is cheaper than letting the agent drift off-track with a stale or incorrect plan.

---

## Three-Phase Architecture

### Phase 1: Define Requirements (Human + LLM)

**Goal**: Create specification documents that serve as source-of-truth

**Process**:
1. LLM conversations identify Jobs to Be Done (JTBD)
2. Break JTBDs into topics of concern
3. Generate specification files via subagents loading external context
4. One spec file per topic of concern in `specs/` directory

**Tools**: Can use Claude's AskUserQuestionTool for systematic clarification

### Phase 2: Planning (LLM Only)

**Goal**: Generate or update the implementation plan via gap analysis

**Process**:
1. Ralph studies specifications and source code
2. Spawns up to 250-500 parallel subagents to explore codebase
3. Compares specs against code
4. Performs gap analysis
5. Generates/updates `IMPLEMENTATION_PLAN.md` with prioritized tasks

**Critical Rule**: Plan only. Do NOT implement anything.

### Phase 3: Building (LLM Only)

**Goal**: Implement tasks from the plan, one at a time

**Process**:
1. Select the most important planned task
2. Search the codebase without assumptions
3. Implement functionality
4. Run targeted tests (only 1 subagent for backpressure)
5. Update the plan with discoveries
6. Commit changes
7. Exit for next iteration

**Critical Rule**: One task per loop iteration. Exit after completion.

---

## The Loop Mechanism

### The Simplest Form

```bash
while :; do cat PROMPT.md | claude ; done
```

This elegantly simple loop:
- Feeds the prompt to Claude
- Claude reads the plan, implements one task, commits, exits
- Loop restarts with fresh context
- Repeat until complete

### Context Persistence

The `IMPLEMENTATION_PLAN.md` file persists on disk between iterations, acting as shared state between otherwise isolated loop executions. Each fresh context window:
1. Deterministically loads the same files (PROMPT.md + AGENTS.md + specs/*)
2. Reads current state from the plan file
3. Makes progress on one task
4. Updates the plan
5. Exits

### Enhanced Loop Script

```bash
#!/bin/bash
# Usage:
#   ./loop.sh           # Build mode (default)
#   ./loop.sh plan      # Planning mode
#   ./loop.sh 20        # Build mode, max 20 iterations
#   ./loop.sh plan 5    # Planning mode, max 5 iterations

MODE="build"
PROMPT_FILE="PROMPT_build.md"
MAX_ITERATIONS=0
ITERATION=0

# Parse arguments
if [ "$1" = "plan" ]; then
    MODE="plan"
    PROMPT_FILE="PROMPT_plan.md"
    MAX_ITERATIONS=${2:-0}
elif [ "$1" = "plan-work" ]; then
    MODE="plan-work"
    PROMPT_FILE="PROMPT_plan_work.md"
    WORK_DESCRIPTION="$2"
    MAX_ITERATIONS=${3:-0}
elif [[ "$1" =~ ^[0-9]+$ ]]; then
    MAX_ITERATIONS=$1
fi

echo "Starting Ralph loop in $MODE mode"
echo "Prompt file: $PROMPT_FILE"
[ $MAX_ITERATIONS -gt 0 ] && echo "Max iterations: $MAX_ITERATIONS"

while :; do
    ITERATION=$((ITERATION + 1))
    echo "=== Iteration $ITERATION ==="

    # Check iteration limit
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -gt $MAX_ITERATIONS ]; then
        echo "Max iterations reached"
        break
    fi

    # Run Claude
    cat "$PROMPT_FILE" | claude -p \
        --dangerously-skip-permissions \
        --output-format=stream-json \
        --model opus

    EXIT_CODE=$?

    # Check for clean exit (task complete or manual stop)
    if [ $EXIT_CODE -eq 0 ]; then
        # Check if all tasks complete
        if grep -q "ALL_TASKS_COMPLETE" IMPLEMENTATION_PLAN.md 2>/dev/null; then
            echo "All tasks complete!"
            break
        fi
    fi

    # Small delay between iterations
    sleep 2
done

echo "Ralph loop finished after $ITERATION iterations"
```

### CLI Flags Reference

| Flag | Purpose |
|------|---------|
| `-p` | Headless/pipe mode (no interactive prompts) |
| `--dangerously-skip-permissions` | Skip approval prompts for autonomous operation |
| `--output-format=stream-json` | Structured logging output |
| `--model opus` | Use Opus model for complex reasoning |

---

## File Structure

```
project-root/
├── loop.sh                    # The orchestration script
├── PROMPT_build.md            # Building mode instructions
├── PROMPT_plan.md             # Planning mode instructions
├── PROMPT_plan_work.md        # Scoped planning instructions (optional)
├── AGENTS.md                  # Operational guide (build/test commands)
├── IMPLEMENTATION_PLAN.md     # The shared state (auto-generated)
├── specs/                     # Requirement documents
│   ├── [jtbd-topic-a].md
│   └── [jtbd-topic-b].md
└── src/
    └── lib/                   # Shared utilities (pattern discovery source)
```

### File Purposes

#### PROMPT_build.md / PROMPT_plan.md
Mode-specific instruction sets. Use numbered sections where higher numbers indicate more critical guardrails (e.g., 99, 999, 9999 for priority escalation).

#### AGENTS.md
The "heart of the loop" — a brief (~60 lines) operational guide describing:
- Build commands
- Test commands
- Validation commands
- Project-specific patterns and conventions
- This is how backpressure gets wired per-project

**AGENTS.md captures operational learnings, not progress logs.**

#### IMPLEMENTATION_PLAN.md
A prioritized bullet-point task list:
- Generated by planning mode
- Updated during building
- Intentionally disposable
- Can be regenerated when stale

#### specs/* Files
Source-of-truth requirements:
- One file per topic of concern
- No prescribed template — LLM determines optimal format
- Remain relatively stable once created

---

## Prompt Templates

### Planning Mode (PROMPT_plan.md)

```markdown
# Ralph Planning Mode

You are Ralph, an autonomous coding agent in PLANNING mode.

## Your Mission
Study the specifications and source code to create or update the implementation plan.

## Instructions

1. **Study Specifications**
   - Read all files in `specs/` directory
   - Understand the requirements and acceptance criteria

2. **Explore Codebase**
   - Spawn up to 250 parallel subagents to search the codebase
   - Find existing patterns in `src/lib/`
   - Identify what already exists vs. what needs building

3. **Gap Analysis**
   - Compare specifications against existing code
   - Identify missing functionality
   - Note partial implementations

4. **Update Plan**
   - Open `IMPLEMENTATION_PLAN.md`
   - Add new tasks discovered
   - Remove completed tasks
   - Prioritize by dependencies and value

## Critical Rules

99. Plan only. Do NOT implement anything.
999. Do NOT assume functionality is missing; confirm with code search first.
9999. If uncertain about requirements, note questions in the plan for clarification.

## Output

Update `IMPLEMENTATION_PLAN.md` with prioritized tasks, then exit.
```

### Building Mode (PROMPT_build.md)

```markdown
# Ralph Building Mode

You are Ralph, an autonomous coding agent in BUILDING mode.

## Your Mission
Implement ONE task from the implementation plan, validate it works, then exit.

## Instructions

1. **Read the Plan**
   - Open `IMPLEMENTATION_PLAN.md`
   - Select the highest-priority incomplete task

2. **Research First**
   - Search the codebase for related code
   - Check `src/lib/` for utilities you can reuse
   - Do NOT assume — verify with code search

3. **Implement**
   - Write the code for this ONE task
   - Follow patterns found in existing code
   - Keep changes minimal and focused

4. **Validate**
   - Run the project's test suite
   - Run type checking
   - Run linting
   - Fix any failures before proceeding

5. **Update Plan**
   - Mark the task complete in `IMPLEMENTATION_PLAN.md`
   - Add any discoveries or new tasks found
   - Note blockers if encountered

6. **Commit**
   - Create a meaningful commit message
   - Reference the task/feature ID if applicable

7. **Exit**
   - After ONE task is complete, exit
   - The loop will restart you with fresh context

## Critical Rules

99. Only ONE task per iteration. Do not continue to the next task.
999. Tests must pass before committing. No exceptions.
9999. If tests fail and you cannot fix them, document the issue and exit.
99999. Do not leave TODO comments or placeholder code.

## Build/Test Commands (from AGENTS.md)

- Build: `bun run build` or `npm run build`
- Test: `bun test` or `npm test`
- Typecheck: `bun run typecheck` or `npm run typecheck`
- Lint: `bun run lint` or `npm run lint`
```

### AGENTS.md Template

```markdown
# Project Operations Guide

## Build Commands
- `bun run build` - Compile the project
- `bun test` - Run test suite

## Conventions
- Use `interface` over `type` for object shapes
- No semicolons
- Use explicit type imports: `import type { Foo }`

## Key Directories
- `src/` - Main source code
- `src/lib/` - Shared utilities (check here first!)
- `tests/` - Test files

## Validation Checklist
Before committing, ensure:
- [ ] All tests pass
- [ ] Type checking passes
- [ ] No lint errors
- [ ] No TODO/FIXME comments
- [ ] Commit message is meaningful
```

---

## Key Principles

### 1. One Task Per Iteration

**Why**:
- Maximizes context utilization in the "smart zone"
- Prevents context pollution from accumulated work
- Enables clean exit and restart
- Creates natural checkpoints

**Implementation**:
```markdown
## Critical Rule 99
Only ONE task per iteration. After completing a task and committing,
you MUST exit. The loop will restart you with fresh context.
```

### 2. Subagents Are Cheap, Context Is Expensive

**Why**:
- Each subagent gets its own ~156kb context
- Subagent context is garbage-collected after completion
- Main context accumulates; subagent context doesn't

**Implementation**:
```markdown
## Research Strategy
Spawn subagents liberally for:
- Codebase searches
- Pattern discovery
- Dependency analysis
- Documentation lookup

Reserve main context for:
- Implementation
- Decision making
- Plan updates
```

### 3. Tests Are The Mechanism

**Why**:
- Tests create backpressure that enforces quality
- Failed tests prevent bad commits
- Test requirements from acceptance criteria ensure completeness

**Implementation**:
```markdown
## Validation Requirements
Before ANY commit:
1. Run `bun test` — ALL tests must pass
2. Run `bun run typecheck` — No type errors
3. Run `bun run lint` — No lint errors

If validation fails, fix the issues. Do not commit broken code.
```

### 4. The Plan Is Shared State

**Why**:
- `IMPLEMENTATION_PLAN.md` persists between iterations
- It's the only communication channel between loop executions
- Updates to the plan carry forward

**Implementation**:
- Always read the plan at the start of each iteration
- Always update the plan before exiting
- Use consistent formatting for easy parsing
- Mark completed items clearly

### 5. Determinism Through Simplicity

**Why**:
- Same inputs → predictable behavior
- File-based state is explicit and observable
- No hidden state or magic

**Implementation**:
- All context comes from files (PROMPT, AGENTS, specs, plan)
- No reliance on conversation history (it's wiped each iteration)
- Changes must be committed to persist

---

## Integration with Ralph Orchestrator

This Ralph project is an **orchestrator** that runs Claude Code inside Docker containers. The Ralph Wiggum technique can enhance this architecture.

### Current Architecture vs. Ralph Wiggum

| Aspect | Current Ralph | Ralph Wiggum Enhancement |
|--------|--------------|-------------------------|
| Task Definition | `features.json` | `specs/*.md` + `IMPLEMENTATION_PLAN.md` |
| Progress Tracking | `passes: true/false` | Plan updates + git commits |
| Loop Control | TypeScript orchestrator | Shell loop + prompt files |
| Context Management | Single long-running session | Fresh context per iteration |
| Backpressure | Verification commands | Tests + types + lint + validation pipeline |

### Hybrid Integration Strategy

The Ralph orchestrator can incorporate Ralph Wiggum patterns:

#### Option 1: Parallel Systems
Keep `features.json` for high-level goals, add Ralph Wiggum files for implementation:

```
project/
├── features.json              # High-level goals (Ralph orchestrator)
├── specs/                     # Detailed specs (Ralph Wiggum)
├── IMPLEMENTATION_PLAN.md     # Task breakdown (Ralph Wiggum)
├── AGENTS.md                  # Operations guide (Ralph Wiggum)
└── PROMPT_build.md           # Build instructions (Ralph Wiggum)
```

#### Option 2: Features as Specs
Transform `features.json` entries into spec files:

```typescript
// Convert features.json to specs/
for (const feature of features) {
  const specContent = `
# ${feature.id}: ${feature.description}

## Acceptance Criteria
${feature.acceptance || 'Not specified'}

## Verification
\`\`\`bash
${feature.verification}
\`\`\`
`
  await Bun.write(`specs/${feature.id}.md`, specContent)
}
```

#### Option 3: Orchestrator-Managed Wiggum
The Ralph orchestrator manages the Wiggum loop:

```typescript
// ralph.ts enhancement
async function runWiggumIteration(containerName: string) {
  // Inject PROMPT_build.md content
  const promptContent = await Bun.file('templates/PROMPT_build.md').text()

  // Run Claude with the prompt
  await Bun.$`docker exec -u node ${containerName} bash -c "
    echo '${promptContent}' | claude -p --dangerously-skip-permissions
  "`

  // Check if plan shows ALL_TASKS_COMPLETE
  const plan = await Bun.$`docker exec -u node ${containerName} cat IMPLEMENTATION_PLAN.md`.text()
  return plan.includes('ALL_TASKS_COMPLETE')
}

// Main loop
while (true) {
  const complete = await runWiggumIteration(containerName)
  if (complete) break
}
```

### Benefits of Integration

1. **Structured Planning**: Specs provide clearer requirements than `features.json`
2. **Granular Progress**: `IMPLEMENTATION_PLAN.md` shows detailed task breakdown
3. **Better Backpressure**: AGENTS.md wires project-specific validation
4. **Context Efficiency**: Fresh context per iteration prevents drift
5. **Observable State**: All state is in files, not conversation history

---

## Implementation Guide

### Step 1: Create Project Structure

```bash
# From project root
mkdir -p specs

# Create AGENTS.md
cat > AGENTS.md << 'EOF'
# Project Operations Guide

## Commands
- Build: `bun run build`
- Test: `bun test`
- Typecheck: `bun run typecheck`

## Conventions
[Add project-specific patterns]
EOF

# Create initial plan
cat > IMPLEMENTATION_PLAN.md << 'EOF'
# Implementation Plan

## Status: PLANNING_NEEDED

## Tasks
(To be populated by planning phase)
EOF
```

### Step 2: Create Specification Files

For each feature/JTBD, create a spec file:

```markdown
# specs/user-authentication.md

## Overview
Implement user authentication with JWT tokens.

## Requirements
1. Users can register with email/password
2. Users can login and receive JWT token
3. Protected routes require valid JWT
4. Tokens expire after 24 hours

## Acceptance Criteria
- [ ] Registration creates user in database
- [ ] Login returns valid JWT
- [ ] Invalid credentials return 401
- [ ] Expired tokens are rejected

## Technical Notes
- Use bcrypt for password hashing
- Store JWT secret in environment variable
- Follow existing patterns in `src/lib/auth/`
```

### Step 3: Create Prompt Files

Save the templates from [Prompt Templates](#prompt-templates) as:
- `PROMPT_plan.md`
- `PROMPT_build.md`

Customize the build/test commands to match your project.

### Step 4: Create the Loop Script

Save the enhanced loop script from [Enhanced Loop Script](#enhanced-loop-script) as `loop.sh`:

```bash
chmod +x loop.sh
```

### Step 5: Run Planning Phase

```bash
./loop.sh plan
```

This will:
1. Read all specs
2. Analyze the codebase
3. Generate `IMPLEMENTATION_PLAN.md` with prioritized tasks

### Step 6: Run Building Phase

```bash
./loop.sh
# Or with iteration limit:
./loop.sh 50
```

This will:
1. Read the plan
2. Implement one task
3. Validate
4. Commit
5. Update plan
6. Exit and restart
7. Repeat until complete

### Step 7: Monitor Progress

Watch the implementation:

```bash
# Follow plan updates
watch -n 5 cat IMPLEMENTATION_PLAN.md

# Follow git commits
watch -n 5 git log --oneline -10
```

---

## Advanced Patterns

### Acceptance-Driven Backpressure

Derive test requirements from acceptance criteria during planning:

```markdown
# In PROMPT_plan.md, add:

## Test Derivation
For each acceptance criterion in specs, create a corresponding test case.
Add these to the plan as "Write test: [description]" tasks BEFORE
the implementation tasks. Tests must be written first.
```

This ensures test-driven development where tests are specified before implementation.

### Non-Deterministic Backpressure (LLM-as-Judge)

For subjective criteria (tone, aesthetics, UX), use LLM evaluation:

```typescript
// src/lib/review.ts
interface ReviewResult {
  pass: boolean
  confidence: number
  feedback: string
}

async function reviewWithLLM(
  content: string,
  criteria: string,
  mode: 'fast' | 'smart' = 'fast'
): Promise<ReviewResult> {
  const model = mode === 'fast' ? 'haiku' : 'opus'

  const prompt = `
Evaluate the following content against the criteria.
Respond with JSON: { "pass": boolean, "confidence": 0-1, "feedback": "..." }

## Criteria
${criteria}

## Content
${content}
`

  const result = await Bun.$`claude -p "${prompt}" --model ${model}`.text()
  return JSON.parse(result)
}
```

### Work-Scoped Branching

Create focused plans for specific work:

```bash
# Create a branch for specific work
git checkout -b feature/user-auth

# Run scoped planning
./loop.sh plan-work "Implement user authentication feature"
```

The `plan-work` mode creates a plan scoped to specific work rather than the entire project.

### SLC Release Mapping

Ground activities in audience context for Simple, Lovable, Complete releases:

```markdown
# In PROMPT_plan.md, add:

## Release Planning
Based on audience JTBD and existing implementations, recommend the
most valuable next release. Focus on horizontal slices that deliver
real value, not vertical slices of partial features.

A release should be:
- **Simple**: Not necessarily "minimum" but easy to understand
- **Lovable**: Delightful to use, not just functional
- **Complete**: Actually solves the user's problem end-to-end
```

---

## Troubleshooting

### Common Issues

#### Agent Gets Stuck on Same Task

**Symptoms**: Multiple iterations with no progress on the same task

**Solutions**:
1. Check if tests are consistently failing — fix the underlying issue
2. Review the task description — it may be ambiguous
3. Delete and regenerate the plan: `./loop.sh plan`
4. Add more specific guidance in AGENTS.md

#### Context Gets Polluted

**Symptoms**: Agent performance degrades over iterations

**Solutions**:
1. Ensure agent exits after each task (check PROMPT_build.md)
2. Verify loop restarts Claude process completely
3. Check for accumulated state in workspace

#### Plan Becomes Stale

**Symptoms**: Plan doesn't match actual project state

**Solutions**:
1. Regenerate plan: `./loop.sh plan`
2. The plan is disposable — regenerating is cheap
3. Add rule to PROMPT_build.md to keep plan current

#### Tests Keep Failing

**Symptoms**: Agent can't get past validation

**Solutions**:
1. Check if tests are flaky or have external dependencies
2. Review test output for specific failures
3. May need human intervention to fix fundamental issues
4. Add test-specific guidance to AGENTS.md

### Debug Mode

Add verbose output to the loop:

```bash
# In loop.sh, add logging
claude -p \
    --dangerously-skip-permissions \
    --output-format=stream-json \
    --model opus \
    2>&1 | tee "logs/iteration-$ITERATION.log"
```

### Circuit Breaker

Add automatic stopping conditions:

```bash
# In loop.sh, add circuit breaker
NO_CHANGE_COUNT=0
LAST_PLAN_HASH=""

while :; do
    # ... run iteration ...

    # Check for progress
    PLAN_HASH=$(md5sum IMPLEMENTATION_PLAN.md | cut -d' ' -f1)
    if [ "$PLAN_HASH" = "$LAST_PLAN_HASH" ]; then
        NO_CHANGE_COUNT=$((NO_CHANGE_COUNT + 1))
        if [ $NO_CHANGE_COUNT -ge 3 ]; then
            echo "Circuit breaker: No progress after 3 iterations"
            break
        fi
    else
        NO_CHANGE_COUNT=0
        LAST_PLAN_HASH=$PLAN_HASH
    fi
done
```

---

## Summary

The Ralph Wiggum technique transforms AI-assisted development from a single long session into a structured, iterative process:

1. **Define** requirements in spec files
2. **Plan** implementation through gap analysis
3. **Build** one task at a time with fresh context
4. **Validate** through tests and backpressure
5. **Iterate** until complete

Key success factors:
- Trust the process (Let Ralph Ralph)
- Keep context fresh (one task per iteration)
- Use tests as backpressure
- Keep the plan disposable
- Move outside the loop (observe, don't micromanage)

For the Ralph orchestrator project, this technique can be integrated to provide more structured planning, better progress visibility, and improved context management through the fresh-context-per-iteration pattern.

---

## References

- **Source Repository**: https://github.com/ghuntley/how-to-ralph-wiggum
- **Geoffrey Huntley**: Author of the Ralph Wiggum technique
- **Beads**: Git-native issue tracker for agents
- **MCP Agent Mail**: Agent-to-agent messaging
- **SLC Framework**: Simple, Lovable, Complete (Jason Cohen)

---

*Last Updated: 2026-01-13*
*Version: 1.0*
