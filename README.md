# Ralph

Autonomous coding agent orchestrator that runs Claude Code inside isolated Docker containers with network restrictions.

## Quick Start

```bash
# Build the base Docker image
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/

# Run Ralph with a features file
bun ralph.ts features.json
```

## Configuration

Set these environment variables:
- `CLAUDE_CODE_OAUTH_TOKEN` - Required: Claude Code OAuth token
- `GITHUB_TOKEN` - Optional: GitHub token (auto-detected from `gh auth token`)

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests
bunx tsc --noEmit    # Type check
```

See [CLAUDE.md](CLAUDE.md) for coding conventions and architecture details.
