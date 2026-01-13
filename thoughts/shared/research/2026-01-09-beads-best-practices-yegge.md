---
date: 2026-01-09T17:33:38Z
researcher: Claude
git_commit: 6166d412b4c5b53c828812a95680fbc5df627320
branch: main
repository: ralph
topic: "Steve Yegge's Beads Best Practices - Agent Issue Tracking"
tags: [research, beads, agent-orchestration, vibe-coding, issue-tracking]
status: complete
last_updated: 2026-01-09
last_updated_by: Claude
source_url: https://steve-yegge.medium.com/beads-best-practices-2db636b9760c
---

# Research: Steve Yegge's Beads Best Practices

**Date**: 2026-01-09T17:33:38Z
**Researcher**: Claude
**Git Commit**: 6166d412b4c5b53c828812a95680fbc5df627320
**Branch**: main
**Repository**: ralph

## Research Question

Study Steve Yegge's Beads Best Practices post to understand best practices for agent-based issue tracking and orchestration.

## Summary

Beads is a **git-native issue tracker** designed as an **execution tool** (not planning) for AI coding agents. It provides shared memory between agent sessions. Key insight: Beads + MCP Agent Mail = complete agent village (shared memory + messaging). The system is 130k lines of Go, 100% "vibe coded," with roughly half being tests.

## Core Philosophy

### What Beads IS
- **Execution tool** - tracking work as it happens
- **Git-native issue tracker** - issues stored in git history
- **Shared memory** between agent sessions
- **Small, focused system** - "a small name for a small system"

### What Beads is NOT
- Not a planning system (use external tools like OpenSpec)
- Not a UI (community builds UIs as passion projects)
- Not an orchestrator (though integrates with them)

## Best Practices

### 1. Run `bd doctor` Regularly
- Diagnoses and auto-fixes issues
- Handles migrations and metadata updates
- Manages git hooks and configuration
- **Recommendation**: Run daily on all repos

### 2. Keep Database Small
- Run `bd cleanup` every few days
- Target: ~200 issues max, rarely exceed 500
- `bd cleanup` deletes issues older than N days
- Run `bd sync` afterwards to sync and push to git
- **Why**: Agents sometimes search issues.jsonl directly; file must be <25k tokens (~500 issues)

### 3. Upgrade Regularly
- Use `bd upgrade` command
- Upgrade at least every 1-2 weeks
- Quality improving rapidly with frequent bug fixes

### 4. Plan Outside Beads, Then Import
**Two-phase approach**:
1. Use planning tool (e.g., OpenSpec) to create plan
2. Have agent file Beads epics/issues from the plan

**For larger plans**:
1. Ask agent to file detailed epics/issues focusing on dependencies, designs, parallelization
2. Ask agent to review, proofread, refine, polish the filed beads
3. Can iterate up to 5 times on plan and 5 times on Beads epics

### 5. Restart Agents Frequently
- One task at a time per agent
- Kill process and start new agent when done
- Beads acts as working memory between sessions
- **Benefits**: Saves money, better model performance

### 6. File Lots of Issues
- File beads for any work >2 minutes
- During code reviews, tell agent to file beads as it goes
- Results in more actionable code review outcomes
- Models often file spontaneously, but nudging helps

### 7. Use Short Issue Prefixes
- Examples: `bd-`, `vc-`, `wy-`, `ef-`, `gt-`
- Improves readability
- Can change prefix later via Beads commands

### 8. Handle Merge Conflicts
- Beads is complex; conflicts happen during merges
- Getting better each week as edge cases are fixed
- Ask agent to clean up Beads messes (broken rebases, conflicts)

## Agent Village Architecture

### Beads + MCP Agent Mail
- **Beads** = shared memory
- **MCP Agent Mail** = agent-to-agent messaging
- Together = complete agent village
- No massive setup required - give task, let agents sort it out
- Agents quickly decide on leader and split work (no ego)

### Two Workflow Models

**1. Single Folder (Jeffrey Emanuel's approach)**
- All agents in same repo clone
- Uses file reservation system (like old VCS)
- Agents figure out file locking amongst themselves

**2. Git Worktree (Yegge's approach)**
- Uses git branches instead of file reservation
- Each agent in separate worktree
- MCP Agent Mail modified to support this model

## Key Insights

### AI Hydrates "Crummy" Architecture
Beads is described as a "crummy architecture (by pre-AI standards)" that requires AI to work around edge cases. But AI always gets it working without too much effort, making it "uncrummy."

### The 130k Lines Reality
- 100% vibe coded
- ~65k lines of Go code
- ~65k lines of tests
- Sometimes 50k lines changing per day
- None of the contributors look at the code

## Relevance to Ralph

This research is directly applicable to Ralph's orchestrator design:

1. **Issue tracking pattern**: Ralph could integrate with Beads for persistent task state across container iterations
2. **Agent restart pattern**: Aligns with Ralph's container-per-iteration approach
3. **Shared memory**: Beads provides the persistence layer Ralph needs between agent runs
4. **Multi-agent potential**: MCP Agent Mail integration could enable parallel agent workers

## Related Concepts

- **MCP Agent Mail**: github.com/jeffreyemanuel/mcp-agent-mail
- **Vibe Coding book**: By Steve Yegge and Gene Kim
- **OpenSpec**: Planning tool that pairs with Beads

## Open Questions

1. How would Beads integrate with Ralph's Docker-based isolation?
2. Could Beads replace or complement Ralph's features.json approach?
3. What would multi-agent Ralph with MCP Agent Mail look like?
