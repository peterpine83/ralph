# Ralph Planning Mode

You are analyzing this codebase to generate an implementation plan. You may be invoked multiple times - check existing progress and continue from where you left off.

## First: Check Current State

1. Check if `.ralph/IMPLEMENTATION_PLAN.md` exists - if so, read it to continue from where you left off
2. Check if a PR already exists: `gh pr view HEAD --json url 2>/dev/null`
3. If PR exists, you're continuing previous work. If not, this is the first iteration.

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
git add .ralph/IMPLEMENTATION_PLAN.md
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
- Simply exit without making any more commits
- The orchestrator detects "PR exists + no new commits" = planning complete
