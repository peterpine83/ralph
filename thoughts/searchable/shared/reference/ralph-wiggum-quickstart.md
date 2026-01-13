# Ralph Wiggum Quick Reference

**For full documentation, see**: `thoughts/shared/reference/ralph-wiggum-technique.md`

---

## TL;DR

Ralph Wiggum = Autonomous AI coding via iterative loops with fresh context per task.

```bash
while :; do cat PROMPT.md | claude -p --dangerously-skip-permissions; done
```

---

## Core Files

| File | Purpose |
|------|---------|
| `PROMPT_plan.md` | Planning instructions (gap analysis) |
| `PROMPT_build.md` | Building instructions (one task) |
| `AGENTS.md` | Project operations (build/test commands) |
| `IMPLEMENTATION_PLAN.md` | Shared state between iterations |
| `specs/*.md` | Requirement documents |

---

## Quick Setup

```bash
# 1. Create structure
mkdir specs
touch AGENTS.md IMPLEMENTATION_PLAN.md PROMPT_plan.md PROMPT_build.md

# 2. Write AGENTS.md with build/test commands
# 3. Create specs for each feature
# 4. Run planning: ./loop.sh plan
# 5. Run building: ./loop.sh
```

---

## Key Rules

1. **One task per iteration** — Exit after each task
2. **Tests must pass** — Never commit broken code
3. **Plan is disposable** — Regenerate freely
4. **Subagents are cheap** — Spawn liberally for research
5. **Context is precious** — Keep main context clean

---

## Loop Script (Minimal)

```bash
#!/bin/bash
MODE=${1:-build}
PROMPT="PROMPT_${MODE}.md"
while :; do
    cat "$PROMPT" | claude -p --dangerously-skip-permissions --model opus
    grep -q "ALL_TASKS_COMPLETE" IMPLEMENTATION_PLAN.md && break
    sleep 2
done
```

---

## Prompt Template (Build Mode)

```markdown
# Building Mode

1. Read `IMPLEMENTATION_PLAN.md`
2. Select highest-priority task
3. Search codebase first (don't assume)
4. Implement ONE task
5. Run tests: `bun test`
6. Update plan, mark task done
7. Commit
8. EXIT (critical!)

## Rule 99: ONE task only, then exit
## Rule 999: Tests MUST pass before commit
```

---

## Debugging Checklist

- [ ] Agent exits after each task?
- [ ] Loop restarts Claude cleanly?
- [ ] Tests are deterministic?
- [ ] Plan getting updated?
- [ ] AGENTS.md has correct commands?

---

## Integration with Ralph Orchestrator

```typescript
// In container, run Wiggum-style iteration
await Bun.$`docker exec ${container} bash -c "
  cat PROMPT_build.md | claude -p --dangerously-skip-permissions
"`
```

---

## Common Commands

```bash
# Planning phase
./loop.sh plan

# Building phase
./loop.sh

# Limited iterations
./loop.sh 20

# Scoped planning
./loop.sh plan-work "implement auth feature"

# Regenerate plan (when stuck)
rm IMPLEMENTATION_PLAN.md && ./loop.sh plan
```
