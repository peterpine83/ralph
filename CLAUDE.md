# CLAUDE.md

## Specifications

**IMPORTANT:** Before implementing any feature, consult the specifications in `specs/README.md`.

- **Assume NOT implemented.** Many specs describe planned features that may not yet exist in the codebase.
- **Check the codebase first.** Before concluding something is or isn't implemented, search the actual code. Specs describe intent; code describes reality.
- **Use specs as guidance.** When implementing a feature, follow the design patterns, types, and architecture defined in the relevant spec.
- **Spec index:** `specs/README.md` lists all specifications organized by category.

## Overview

Ralph is an autonomous coding agent orchestrator that runs Claude Code inside
isolated Docker containers with network restrictions. It processes features
from `.ralph/features.json`, implementing them until all pass verification.

## Commands

```bash
bun test                    # Run tests
bun run typecheck           # TypeScript type checking
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/
```

## Code Style

### Effect.ts Patterns

Use `Effect.gen` for sequential operations:
```typescript
const program = Effect.gen(function* () {
  const docker = yield* DockerService
  const result = yield* docker.exec(container, cmd)
  return result
})
```

Tagged errors with `Data.TaggedError`:
```typescript
class ContainerError extends Data.TaggedError("ContainerError")<{
  message: string
  cause?: unknown
}>() {}
```

Handle by tag:
```typescript
Effect.catchTag("ContainerError", (e) => /* handle */)
```

### File Organization

- Services: `src/services/ServiceName.ts`
- Layers: `src/layers/ServiceNameLive.ts`
- Test layers: `src/layers/test/ServiceNameTest.ts`
- Tests co-located: `foo.ts` → `foo.test.ts`

### TypeScript Conventions

- Use `readonly` for interface properties
- Prefix service interfaces with `I` (e.g., `IDockerService`)
- Explicit return types on exported functions

## Testing

Run tests: `bun test`
Run specific: `bun test src/file.test.ts`
Watch mode: `bun test --watch`

Use test layers from `src/layers/test/` for mocking services.

## Architecture

### Service Pattern
Operations are abstracted behind Effect Services (ConfigService, DockerService, ClaudeService, GitService, DashboardService) for:
- **Testability**: Services can be mocked via test Layers
- **Swappability**: Implementations can change without affecting consumers
- **Dependency injection**: Layers compose services with explicit dependencies

### Error Philosophy
- **Tagged unions**: Every error has a unique `_tag` for pattern matching via `Effect.catchTag`
- **Context preservation**: Errors include command, exit code, stderr for debugging
- **Fatal vs Recoverable**:
  - Fatal: ConfigError, FeatureError, CircuitBreakerError, ValidationError
  - Recoverable: DockerError (retry), TimeoutError (continue), GitError (log), StreamError (skip)

## File Locations

| Purpose | Path |
|---------|------|
| Entry point | `src/main.ts` |
| Orchestration logic | `src/program.ts` |
| CLI argument parsing | `src/args.ts` |
| Service interfaces | `src/services/*.ts` |
| Layer implementations | `src/layers/*.ts` |
| Error types | `src/errors/index.ts` |
| Stream utilities | `src/streams/ndjson.ts` |
| Type definitions | `src/types.ts` |
| Base Dockerfile | `docker/Dockerfile.base` |
| Entrypoint script | `docker/entrypoint.sh` |
| Firewall script | `docker/init-firewall.sh` |
| Claude prompt template | `templates/ralph-instructions.md` |
