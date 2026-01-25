# Ralph Planning Mode

You are analyzing this codebase to generate an implementation plan. You may be invoked multiple times - check existing progress and continue from where you left off.

## First: Check Current State

1. Check if `.ralph/plan-status.json` exists - read it to see current iteration and completion status
2. Check if `.ralph/IMPLEMENTATION_PLAN.md` exists - if so, read it to continue from where you left off
3. Check if a PR already exists: `gh pr view HEAD --json url 2>/dev/null`
4. If PR exists, you're continuing previous work. If not, this is the first iteration.

## Status Tracking (Critical for Exit)

You MUST maintain `.ralph/plan-status.json` to signal your progress:

**On first iteration**, create the file:
```json
{
  "complete": false,
  "iteration": 1
}
```

**On each subsequent iteration**, increment the iteration count:
```json
{
  "complete": false,
  "iteration": 2
}
```

**When your plan is comprehensive**, set complete to true:
```json
{
  "complete": true,
  "iteration": 5
}
```

The orchestrator reads this file to know when to stop. Setting `complete: true` is how you signal that planning is done.

## Research Phase

Study the codebase using parallel subagents:
- `specs/*` - application specifications
- `src/lib/*` - shared utilities and components
- `src/*` - application source code
- `.ralph/IMPLEMENTATION_PLAN.md` - existing plan (if present)

Compare source code against specs to identify gaps. Consider:
- TODO comments
- Minimal/placeholder implementations
- Skipped/flaky tests
- Inconsistent patterns
- Missing features from specs

## Critical Rules

- Plan only. Do NOT implement anything.
- Do NOT assume functionality is missing; confirm with code search first.
- Treat `src/lib` as the standard library - extend rather than rewrite.

## Output

Write to `.ralph/IMPLEMENTATION_PLAN.md`:

```markdown
# Implementation Plan

## Completed
- [x] Item that exists and works

## Priority 1: [Category]
- [ ] Task description (refs: specs/file.md, src/file.ts)

## Priority 2: [Category]
- [ ] Task description

## Discoveries
- Found existing X in src/lib/foo.ts — extend rather than rewrite

## Blockers
- External dependency needed
```

## Git Workflow

### Every iteration where you make changes:

```bash
git add .ralph/IMPLEMENTATION_PLAN.md .ralph/plan-status.json
git commit -m "Plan: <brief description of changes>"
```

### First iteration (no PR exists yet):
```bash
git push -u origin HEAD
gh pr create --title "Plan: Implementation plan" --body "Auto-generated implementation plan from Ralph planning mode" --draft
```

### Subsequent iterations (PR already exists):
```bash
git push
```

## Completion

When your research is complete and the plan is comprehensive:
1. Update `.ralph/plan-status.json` with `"complete": true`
2. Commit this change along with your final plan update
3. Push to the remote

The orchestrator detects `complete: true` in the status file and exits the loop.
