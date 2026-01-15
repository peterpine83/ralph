# CLAUDE.md

Ralph is an autonomous coding agent orchestrator that runs Claude Code inside isolated Docker containers with network restrictions. It processes features from `.ralph/features.json`, implementing them until all pass their verification commands.

## Commands

```bash
bun test                    # run tests
bun run typecheck           # run TypeScript type checking
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/
```

## Project Structure

```
your-project/
└── .ralph/
    └── features.json    # defines features to implement
```

## IMPORTANT to Reference the SPEC Documentation for relevant context.
### specs/
- full project specification. README.md is the lookup table. 
