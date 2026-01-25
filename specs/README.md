# Ralph Specifications

Design documentation for Ralph, an autonomous coding agent orchestrator.

## Core Architecture

| Spec | Code | Purpose |
|------|------|---------|
| [zfc-architecture.md](./zfc-architecture.md) | [src/](../src/) | ZFC principles and compliance |
| [orchestrator.md](./orchestrator.md) | [src/program.ts](../src/program.ts) | Main loop, iteration control, circuit breaker |

## Container & Infrastructure

| Spec | Code | Purpose |
|------|------|---------|
| [container.md](./container.md) | [src/services/Docker.ts](../src/services/Docker.ts) | Docker lifecycle management |
| [networking.md](./networking.md) | [docker/init-firewall.sh](../docker/init-firewall.sh) | Firewall and domain whitelisting |

## Integration

| Spec | Code | Purpose |
|------|------|---------|
| [claude-integration.md](./claude-integration.md) | [src/services/Claude.ts](../src/services/Claude.ts) | Claude CLI invocation, stream parsing |
| [features.md](./features.md) | [src/types.ts](../src/types.ts) | features.json format and processing |

## Observability

| Spec | Code | Purpose |
|------|------|---------|
| [dashboard.md](./dashboard.md) | [src/services/Dashboard.ts](../src/services/Dashboard.ts) | SSE server and state management |
| [logging-telemetry.md](./logging-telemetry.md) | [src/program.ts](../src/program.ts) | JSONL persistence, iteration metrics |

## Planning & Roadmap

| Spec | Code | Purpose |
|------|------|---------|
| [architecture-v2.md](./architecture-v2.md) | — | Future multi-agent architecture |
