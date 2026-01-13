# CLAUDE.md

Ralph is an autonomous coding agent orchestrator that runs Claude Code inside isolated Docker containers with network restrictions. It processes features from `features.json`, implementing them until all pass their verification commands.

## Commands

```bash
bun ralph.ts [features.json] [--branch <name>] [--once] [--max-iterations <n>]
bun test                    # run tests
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/
```

## Architecture

- **`ralph.ts`** - Main orchestrator: creates container, copies project, runs Claude, repeats until features pass or circuit breaker triggers (3 iterations with no git changes)
- **`src/args.ts`** - CLI argument parsing
- **`src/container.ts`** - Pure functions for Docker command generation and output parsing
- **`docker/`** - Container infrastructure (Dockerfile.base, entrypoint.sh, init-firewall.sh)

## Key Patterns

- Business logic in `src/` as pure functions, orchestration in `ralph.ts`
- Container runs as non-root `node` user (required for `--dangerously-skip-permissions`)
- `CLAUDE_CODE_OAUTH_TOKEN` env var required; `GITHUB_TOKEN` auto-detected from `gh auth token`

## Coding Conventions

### TypeScript Style
- **No semicolons**
- **Use `interface` over `type`** for object shapes (use `type` only for unions, primitives, function types)
- **Explicit type imports** - Use `import type { Foo }` for type-only imports

```typescript
// Good
import type { SessionConfig } from "./container"
interface WorkspaceState { branch: string; modifiedFiles: string[] }

// Bad
import { SessionConfig } from "./container"  // missing 'type'
type WorkspaceState = { branch: string }     // use interface
const x = 1;                                  // no semicolons
```

### Bun Patterns
- Use `Bun.$` template literals for shell commands
- Use `.nothrow()` for commands that may fail, `.quiet()` to suppress output
- Use `.catch(() => fallback)` for optional commands

```typescript
const output = await Bun.$`docker ps`.text()
const result = await Bun.$`docker rm ${name}`.nothrow().quiet()
const token = await Bun.$`gh auth token`.text().catch(() => "")
```

### Testing
- Use `bun:test` (`describe`, `test`, `expect`); test files alongside source: `src/foo.ts` → `src/foo.test.ts`
- Test pure functions without Docker dependencies

```typescript
import { describe, expect, test } from "bun:test"

describe("parseArgs", () => {
  test("returns defaults when no args", () => {
    expect(parseArgs([]).featuresPath).toBe("features.json")
  })
})
```

### Error Handling
Use `.catch()` for fallbacks, `.nothrow()` for exit codes, `console.error()` for logging.

## Reference Documentation

### thoughts/shared/reference/
- **`ralph-wiggum-technique.md`** - Comprehensive guide to the Ralph Wiggum autonomous AI coding methodology (iterative loops, fresh context per task, specs → plan → build pattern)
- **`ralph-wiggum-quickstart.md`** - Quick reference card for Ralph Wiggum patterns

### thoughts/shared/research/
- **`2026-01-09-beads-best-practices-yegge.md`** - Steve Yegge's Beads (git-native issue tracker for agents)

### thoughts/shared/plans/
- **`2026-01-09-zfc-validation-pipeline.md`** - ZFC (Zero Framework Cognition) + validation pipeline implementation plan

## Related Concepts

- **Ralph Wiggum Technique**: External methodology from Geoffrey Huntley for autonomous AI coding via iterative loops with disposable plans and test-driven backpressure. See `thoughts/shared/reference/ralph-wiggum-technique.md`
- **Beads**: Git-native issue tracker designed as shared memory between agent sessions
- **ZFC**: Zero Framework Cognition - delegating all cognitive decisions to AI evaluation rather than hardcoded heuristics
