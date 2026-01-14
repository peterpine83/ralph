# CLAUDE.md

Ralph is an autonomous coding agent orchestrator that runs Claude Code inside isolated Docker containers with network restrictions. It processes features from `features.json`, implementing them until all pass their verification commands.

## Commands

```bash
bun ralph.ts [features.json] [--branch <name>] [--once] [--max-iterations <n>]
bun test                    # run tests
docker build -t ralph-base:latest -f docker/Dockerfile.base docker/
```

## Reference Documentation
### specs/
- full project specification. README.md is the lookup table. 
### thoughts/shared/reference/
- **`ralph-wiggum-technique.md`** - Comprehensive guide to the Ralph Wiggum autonomous AI coding methodology (iterative loops, fresh context per task, specs → plan → build pattern)
- **`ralph-wiggum-quickstart.md`** - Quick reference card for Ralph Wiggum patterns

## Related Concepts

- **Ralph Wiggum Technique**: External methodology from Geoffrey Huntley for autonomous AI coding via iterative loops with disposable plans and test-driven backpressure. See `thoughts/shared/reference/ralph-wiggum-technique.md`
