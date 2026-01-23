# Ralph Specifications

This directory contains modular specifications for the Ralph autonomous coding orchestrator. Each spec file covers a distinct subsystem, enabling token-efficient context loading when working on specific parts.

## Quick Reference

### Core Specs

| Spec | File | Description |
|------|------|-------------|
| **ZFC Architecture** | [zfc-architecture.md](./zfc-architecture.md) | Zero Framework Cognition principles, compliance guide |
| **Orchestrator** | [orchestrator.md](./orchestrator.md) | Main loop, iteration control, circuit breaker |
| **Container** | [container.md](./container.md) | Docker lifecycle, pure utility functions |
| **Features** | [features.md](./features.md) | features.json format, processing pipeline |
| **Networking** | [networking.md](./networking.md) | Firewall, iptables, domain whitelisting |
| **Claude Integration** | [claude-integration.md](./claude-integration.md) | CLI invocation, stream-json parsing |
| **Dashboard** | [dashboard.md](./dashboard.md) | SSE server, HTTP endpoints, state management |
| **Logging & Telemetry** | [logging-telemetry.md](./logging-telemetry.md) | JSONL persistence, iteration metrics, prompt tuning |

## System Overview

```
                                    ┌─────────────────────────────────────┐
                                    │         src/main.ts                 │
                                    │    → program.ts (Orchestrator)      │
                                    │                                     │
                                    │  ┌─────────────────────────────┐   │
                                    │  │  mainLoop (Effect.iterate)  │   │
                                    │  │  ├─ Read features.json      │   │
                                    │  │  ├─ Run Claude via Service  │   │
                                    │  │  ├─ Monitor timeout         │   │
                                    │  │  └─ Check git changes       │   │
                                    │  └─────────────────────────────┘   │
                                    └─────────────┬───────────────────────┘
                                                  │
                                                  │ DockerService.exec
                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Docker Container                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────────────────┐ │
│  │  Firewall    │    │  /workspace  │    │        Claude Code CLI         │ │
│  │  (iptables)  │    │  - git repo  │    │  - Reads .ralph-prompt.md      │ │
│  │              │    │  - features  │    │  - Implements ONE feature      │ │
│  │  Whitelist:  │    │  - source    │    │  - Commits & pushes            │ │
│  │  - Anthropic │    │              │    │  - Exits (fresh context)       │ │
│  │  - GitHub    │    │              │    │                                │ │
│  │  - npm       │    │              │    │                                │ │
│  └──────────────┘    └──────────────┘    └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Zero Framework Cognition (ZFC)
Ralph follows [ZFC principles](./zfc-architecture.md): the orchestrator is a "thin, safe, deterministic shell" that delegates ALL reasoning to Claude.

**Orchestrator handles**: IO, plumbing, policy enforcement, structural validation
**Claude handles**: Feature selection, implementation decisions, verification judgment

See [zfc-architecture.md](./zfc-architecture.md) for compliance checklist and anti-patterns.

### Ralph Wiggum Technique
Ralph implements the "Ralph Wiggum" autonomous AI methodology:
- **Fresh context per iteration**: Each Claude invocation starts clean
- **Git as memory**: All state persists through commits
- **Specs-first**: Define expected outcomes before implementation
- **Disposable plans**: Context can be regenerated from git history

### State Model
- **Orchestrator state**: In-memory (iteration count, no-change counter)
- **Persistent state**: Git repository inside container
- **Shared state**: features.json (Claude reads/writes, orchestrator monitors)

### Security Model
- Non-root execution (required for `--dangerously-skip-permissions`)
- Network isolation via iptables whitelist
- Capability-limited container (`CAP_NET_ADMIN` only for firewall setup)

## Design Decisions

### ZFC Architecture
Ralph is designed as a **ZFC-compliant** orchestrator:
- No keyword matching on Claude output
- No heuristic classification or ranking
- No semantic analysis of text content
- All decisions delegated to Claude via structured data (features.json)

This makes Ralph resilient to edge cases that would break pattern-matching approaches.

### Effect.ts Foundation
Ralph uses Effect.ts for type-safe, composable programming. This choice replaced:
- **Manual try-catch** → Typed error channels with unique `_tag` discriminators
- **Global environment variables** → ConfigService with validated configuration
- **Bun.$ shell commands** → @effect/platform Command for structured execution
- **Mutable state** → Effect Ref for thread-safe, immutable state
- **Raw streams** → Effect Stream for backpressure, cleanup, and composition

### Service Architecture
Operations are abstracted behind Effect Services (ConfigService, DockerService, ClaudeService, GitService, DashboardService) for:
- **Testability**: Services can be mocked via test Layers
- **Swappability**: Implementations can change without affecting consumers
- **Dependency injection**: Layers compose services with explicit dependencies

### Error Philosophy
- **Tagged unions**: Every error has a unique `_tag` for pattern matching via `Effect.catchTag`
- **Context preservation**: Errors include command, exit code, stderr for debugging
- **Fatal vs Recoverable**: Clear categorization guides handling:
  - Fatal: ConfigError, FeatureError, CircuitBreakerError, ValidationError
  - Recoverable: DockerError (retry), TimeoutError (continue), GitError (log), StreamError (skip)

See `CLAUDE.md` for implementation details and service/layer structure.

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

## Usage

When working on a specific subsystem, load only the relevant spec:

```bash
# Working on iteration logic? Load orchestrator spec
cat specs/orchestrator.md

# Debugging network issues? Load networking spec
cat specs/networking.md

# Adding a new Claude output event type? Load claude-integration spec
cat specs/claude-integration.md
```

## Related Documentation

- `CLAUDE.md` - Coding conventions and quick reference
- `docs/ARCHITECTURE-V2.md` - Future architecture (Beads + validation pipeline)
- `thoughts/shared/reference/ralph-wiggum-technique.md` - Methodology deep-dive
