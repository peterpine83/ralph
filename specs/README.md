# Ralph Specifications

This directory contains modular specifications for the Ralph autonomous coding orchestrator. Each spec file covers a distinct subsystem, enabling token-efficient context loading when working on specific parts.

## Quick Reference

| Spec | File | Description |
|------|------|-------------|
| **Orchestrator** | [orchestrator.md](./orchestrator.md) | Main loop, iteration control, circuit breaker |
| **Container** | [container.md](./container.md) | Docker lifecycle, pure utility functions |
| **Features** | [features.md](./features.md) | features.json format, processing pipeline |
| **Networking** | [networking.md](./networking.md) | Firewall, iptables, domain whitelisting |
| **Claude Integration** | [claude-integration.md](./claude-integration.md) | CLI invocation, stream-json parsing |
| **Dashboard** | [dashboard.md](./dashboard.md) | SSE server, HTTP endpoints, state management |

## System Overview

```
                                    ┌─────────────────────────────────────┐
                                    │           ralph.ts                  │
                                    │         (Orchestrator)              │
                                    │                                     │
                                    │  ┌─────────────────────────────┐   │
                                    │  │  Loop (max 5 iterations)    │   │
                                    │  │  ├─ Read features.json      │   │
                                    │  │  ├─ Write .ralph-prompt.md  │   │
                                    │  │  ├─ Spawn Claude            │   │
                                    │  │  ├─ Monitor timeout         │   │
                                    │  │  └─ Check git changes       │   │
                                    │  └─────────────────────────────┘   │
                                    └─────────────┬───────────────────────┘
                                                  │
                                                  │ docker exec
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

## File Locations

| Purpose | Path |
|---------|------|
| Main orchestrator | `ralph.ts` |
| CLI argument parsing | `src/args.ts` |
| Container utilities | `src/container.ts` |
| Type definitions | `src/types.ts` |
| Dashboard server | `src/server.ts` |
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
