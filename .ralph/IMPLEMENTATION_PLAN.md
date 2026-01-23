# Implementation Plan

## Completed

### Effect Migration (Phase 5)
- [x] Error type tests and Stream tests
- [x] ConfigTest, DockerTest, ClaudeTest, GitTest, DashboardTest mock layers
- [x] TestLive layer composition
- [x] Program integration tests
- [x] ralph.ts updated as thin wrapper
- [x] CLAUDE.md documents Effect architecture
- [x] All tests pass, typecheck succeeds

### Core Services
- [x] ConfigService - Environment configuration with CLI args
- [x] DockerService - Container lifecycle management (create, start, remove, inspect, exec, readFile, writeFile, listByPrefix)
- [x] ClaudeService - Claude Code CLI integration with streaming events
- [x] GitService - Git operations (checkout, fetch, push, hasUnpushedCommits, createBranch, configureUser)
- [x] DashboardService - SSE server with state management

### Stream Processing
- [x] NDJSON parsing utilities (parseNDJSON, parseNDJSONWithFallback, fromReadableStream, collectAll, forEach)
- [x] Comprehensive error handling with StreamError
- Note: parseNDJSON has comprehensive tests; other utilities (parseNDJSONWithFallback, fromReadableStream, collectAll, forEach) have no dedicated tests

### Error Types
- [x] Tagged error types (ConfigError, DockerError, ContainerNotFoundError, ClaudeError, TimeoutError, GitError, FeatureError, CircuitBreakerError, StreamError, ValidationError)
- [x] Effect.catchTag integration

### CLI & Configuration
- [x] Argument parsing (--branch, --once, --max-iterations, --dashboard, --dashboard-port, --step, --mode)
- [x] Planning mode support (--mode plan)

### Git Configuration in Container (P1.23, P1.26 - VERIFIED COMPLETE)
- [x] Git safe.directory configured with --system flag (src/program.ts:122-135)
- [x] Credential helper configured with --system flag (src/program.ts:137-151)
- [x] SSH command configured with --system flag (src/program.ts:153-167)

### Clone via Temp Directory (P1.28 - VERIFIED COMPLETE)
- [x] Clone to /tmp/repo intermediate directory (src/program.ts:79-92)
- [x] Copy to /workspace/ (src/program.ts:94-105)
- [x] Chown to node:node (src/program.ts:107-118)

### Keep-Alive Command (P1.37 - VERIFIED COMPLETE)
- [x] Uses `tail -f /dev/null` per spec (DockerLive.ts:81)
- [x] Note: ralph.ts uses `sleep infinity` (divergent but both work)

---

## Priority 1: Critical Integration Gaps

### 1.1 Main Entry Point Integration
- [ ] Wire createSession() to main.ts (refs: src/main.ts:17-58, src/program.ts:23-200)
  - Currently uses placeholder values instead of actual session creation
  - main.ts:29-30 - Comment says "placeholder" with hardcoded `ralph-session-placeholder`
  - main.ts:38-50 - Hardcoded `placeholderState` object with empty defaults
  - main.ts:56-58 - Calls mainLoop with placeholders instead of real session
  - Production flow: parseArgs → validateEnvironment → createSession → mainLoop → cleanup
  - Reference working flow in ralph.ts:349-400 for expected pattern
  - Fix type annotation at line 67 (`as Effect.Effect<void, never, never>`)
  - Add cleanup in finally block (container removal via DockerService.remove())
  - Implement proper error handling with catchTags for fatal vs recoverable errors

### 1.2 Firewall Ready Detection
- [ ] Replace 3-second sleep with log streaming detection (refs: src/program.ts:74, docker/entrypoint.sh)
  - Detect "Ralph Firewall Ready" message from container logs
  - Use Docker logs streaming API or exec with log tail
  - Add timeout safety (fallback after 30s if message not detected)

### 1.3 copyToContainer Implementation
- [ ] Implement DockerLive.copyToContainer() (refs: src/layers/DockerLive.ts:290, src/services/Docker.ts:111-115)
  - Currently returns Effect.dieMessage("Not implemented yet")
  - Required for bulk file operations
  - Use `docker cp` command

### 1.4 Final Verification Logic
- [ ] Implement finalVerificationDone state and logic (refs: specs/orchestrator.md:125-138)
  - When all features marked `passes: true`, run one additional iteration
  - Track `finalVerificationDone` in iteration state
  - If Claude makes changes and pushes: Reset flag
  - Second time all pass without changes: Mark PR ready and exit

### 1.5 Signal Handling (SIGINT/SIGTERM)
- [ ] Implement graceful shutdown on signals (refs: specs/orchestrator.md:156-167)
  - First SIGINT/SIGTERM → set `stopping = true`, abort Claude immediately
  - Second signal → force exit immediately
  - Always run cleanup in finally block (container removal)
  - Update dashboard state to reflect shutdown status
  - Add signal handlers in main.ts before starting orchestration

### 1.6 Environment Variable Validation
- [ ] Validate required environment on startup (refs: specs/orchestrator.md:197-203, src/layers/ConfigLive.ts:35-47)
  - `CLAUDE_CODE_OAUTH_TOKEN` - Required, error if missing
  - Add `ANTHROPIC_API_KEY` fallback (ralph.ts:358 accepts either, ConfigLive:35 only checks OAuth)
  - `GITHUB_TOKEN` - Auto-detect via `gh auth token` if not set (ralph.ts:161, missing in ConfigLive:45)
  - Validate before starting container to fail fast
  - Clear error messages for missing credentials

### 1.7 --once Flag Handling
- [ ] Implement single-iteration mode (refs: src/args.ts:26, src/program.ts:283-335)
  - `--once` flag parsed but not wired to mainLoop
  - When enabled, run exactly one iteration then exit
  - Should still respect circuit breaker and cleanup

### 1.8 maxIterations Enforcement
- [ ] Enforce max iteration limit in mainLoop (refs: src/args.ts:7, src/program.ts:295-297)
  - `maxIterations` parsed at args.ts:35-37 but never checked in loop
  - Add to loop condition: `state.iteration < maxIterations`
  - Currently circuit breaker (3 no-change) is only exit besides feature completion

### 1.9 Startup Cleanup (Moved from P4.4)
- [ ] Clean up stale containers on startup (refs: specs/orchestrator.md:10-21, ralph.ts:136-142)
  - **CRITICAL**: Must run BEFORE createSession() per spec
  - Implement `cleanupStaleContainers()` function
  - Use DockerService.listByPrefix("ralph-") to find orphaned containers
  - Remove stale containers before starting new session
  - Add to main.ts startup sequence, not createSession

### 1.10 Container Health Checks
- [ ] Implement ensureContainerRunning() function (refs: specs/orchestrator.md:28, ralph.ts:144-152)
  - Called at start of each iteration before running Claude
  - Use DockerService.inspect() to check container state
  - Auto-restart with DockerService.start() if stopped
  - Fail iteration if container cannot be restarted

### 1.11 Branch Name Generation
- [ ] Implement branch naming for new sessions (refs: specs/orchestrator.md branch naming, ralph.ts:50-68)
  - Build mode: `ralph/MMDD-HHMM-{feature-slug}` pattern
  - Plan mode: `ralph/MMDD-HHMM-plan` pattern
  - Functions exist in ralph.ts:50-68 as reference
  - Wire to createSession() for non-resume sessions

### 1.12 Features.json Copying (Build Mode)
- [ ] Copy features.json to container for build mode (refs: ralph.ts:217-227)
  - Skip for plan mode (uses .ralph-prompt.md instead)
  - Ensure .ralph directory exists in container
  - Use DockerService.writeFile() or copyToContainer()
  - Required before first iteration in build mode

### 1.13 Resume vs New Session Logic
- [ ] Implement branch resume detection (refs: ralph.ts:381-397)
  - Check if --branch specified
  - Verify branch exists on remote: `git ls-remote --heads origin ${branch}`
  - Set isResume flag for checkout vs create logic
  - Error if specified branch doesn't exist on remote
  - Different flow: resume → checkout existing, new → create branch

### 1.14 Plan Mode Completion Detection
- [ ] Detect when planning is complete (refs: ralph.ts:613-626)
  - After each iteration in plan mode, check:
    1. PR exists: `gh pr view HEAD --json url`
    2. No unpushed commits: compare origin/branch..HEAD
  - If both true, Claude is signaling completion → exit gracefully
  - Different from build mode completion (feature-based)

### 1.15 Prompt Template Write-to-Container Workflow
- [ ] Implement two-step prompt workflow (refs: ralph.ts:406-423, 506-509, 516)
  - Read template from local filesystem (`${RALPH_HOME}/templates/ralph-instructions.md` or `ralph-plan-mode.md`)
  - Write template content to container at `/workspace/.ralph-prompt.md` via heredoc
  - Invoke Claude with path reference: `Read .ralph-prompt.md and follow the instructions.`
  - Template selected based on mode (plan vs build)
  - Effect implementation has placeholder in main.ts:32-35 but no container write

### 1.16 AbortController Pattern for Stop Button
- [ ] Implement AbortController pattern for dashboard stop (refs: ralph.ts:76-82, 513-521)
  - Maintain global `claudeAbortController: AbortController | null`
  - Export `abortClaude()` function that calls `abort()` on controller
  - Wire dashboard callback: `setOnStopCallback(abortClaude)` (ralph.ts:415)
  - Create controller before each Claude invocation, null after finish
  - Dual stop paths converge: SIGINT/SIGTERM and dashboard stop button both use this

### 1.17 Remote URL Extraction for Clone
- [ ] Extract remote URL from host git config (refs: ralph.ts:201)
  - Use `git remote get-url origin` to get actual remote URL
  - Clone from remote URL, not local path (ensures clean state, no uncommitted changes)
  - Current program.ts:82 hardcodes `sessionConfig.gitRoot` as clone source

### 1.18 Clone Branch Selection Logic
- [ ] Implement branch selection for git clone (refs: ralph.ts:202)
  - Resume mode: Clone from the resume branch directly
  - New session: Clone from `trunk`, then create new branch locally
  - Pattern: `const cloneBranch = isResume ? branch : "trunk"`

### 1.19 Unpushed Commit Detection with Dual Paths
- [ ] Handle unpushed detection when remote branch doesn't exist (refs: ralph.ts:541-570)
  - Check if remote branch exists first: `git ls-remote --heads origin ${branch}`
  - If remote exists: Standard `git log origin/${branch}..HEAD`
  - If remote doesn't exist: Check `git log --oneline -1` (new branch case)
  - Push failure should increment noChangeCount (circuit breaker trigger)

### 1.20 PR Ready Command
- [ ] Mark PR as ready when all features pass final verification (refs: ralph.ts:487)
  - Run `gh pr ready ${branch}` to convert draft PR to ready-for-review
  - Use `.quiet().nothrow()` pattern (PR might not exist yet)
  - This is the final automation step before human review

### 1.21 Container User Switching for Exec
- [ ] Implement user flag handling in docker exec calls (refs: ralph.ts:208, 211, 215)
  - Git operations must run as `node` user: `-u node` flag
  - File ownership changes (chown) must run as root: no `-u` flag
  - Pattern: Git commands use `-u node`, file operations use root

### 1.22 Circuit Breaker Timeout Handling
- [ ] Handle timeout case in circuit breaker logic (refs: ralph.ts:530-538)
  - Failed/timed out Claude runs should also increment noChangeCount
  - Current program.ts:324-330 only handles successful runs with no changes
  - Emit bell character (`\x07`) to alert user when circuit breaker triggers

### 1.23 Git Configuration in Container
- [ ] Configure git in container after clone (refs: specs/container.md:103-114)
  - `git config --system safe.directory /workspace`
  - `git config --system credential.helper '!gh auth git-credential'`
  - `git config --system core.sshCommand "ssh -i /tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"`
  - Required for git operations to work correctly in container

### 1.24 Firewall Verification Beyond Message Detection
- [ ] Verify firewall is fully initialized (refs: specs/networking.md:44-99)
  - Beyond detecting "Ralph Firewall Ready" message, verify:
  - DNS resolution works (UDP 53 rule in place)
  - SSH port 22 accessible (for git operations)
  - All 8 whitelisted domains reachable
  - `ipset create allowed-domains hash:net` succeeded

### 1.25 Git Author Environment Defaults
- [ ] Add default git author configuration (refs: ralph.ts:173-174)
  - Pass `GIT_AUTHOR_NAME=${process.env.GIT_AUTHOR_NAME || 'Ralph'}` to container
  - Pass `GIT_AUTHOR_EMAIL=${process.env.GIT_AUTHOR_EMAIL || 'ralph@localhost'}` to container
  - Ensures commits work without user git configuration
  - Missing from program.ts:32-45 container creation

### 1.26 Git Safe Directory --system Flag
- [ ] Use --system flag for git config in container (refs: ralph.ts:193, specs/container.md)
  - `.gitconfig` is mounted read-only (`:ro` flag)
  - Cannot use `--global` because it writes to read-only mounted file
  - Must use `--system` flag for all git config commands
  - Affects P1.23 implementation: all `git config --global` must be `git config --system`

### 1.27 Firewall Polling with Specific Timeout
- [ ] Implement 30-second timeout for firewall detection (refs: ralph.ts:182-189)
  - Poll every 1 second, max 30 iterations
  - `docker logs ${containerName} 2>&1` to check for "Ralph Firewall Ready"
  - Exit loop on message detection or timeout
  - Current P1.2 mentions "30s fallback" but doesn't specify polling interval

### 1.28 Clone via Temp Directory Pattern
- [ ] Use /tmp/repo intermediate directory for clone (refs: ralph.ts:207-211)
  - Cannot clone directly to `/workspace` (git requires empty directory)
  - Pattern: `git clone → /tmp/repo` then `cp -a /tmp/repo/. /workspace/`
  - Then `rm -rf /tmp/repo` and `chown -R node:node /workspace`
  - Currently in program.ts:79-118 but rationale not documented

### 1.29 Container Create+Start Two-Step Pattern
- [ ] Document and verify create/start separation (refs: ralph.ts:164-180)
  - `docker create` with `sleep infinity` command (container not started)
  - `docker start` runs entrypoint.sh (firewall initialization)
  - Two-step ensures entrypoint runs exactly once
  - `sleep infinity` provides long-running process after entrypoint completes

### 1.30 Dual Input Source Race Pattern
- [ ] Implement Promise.race for CLI + dashboard input (refs: ralph.ts:583-596)
  - When step mode active AND dashboard enabled, accept input from either source
  - `Promise.race([promptForAction(), waitForResume()])` pattern
  - `waitForResume()` polls `isPaused()` with 100ms interval
  - First source to respond controls action ("continue" or "stop")
  - Critical for UX when both CLI and browser are active

### 1.31 Host-Side Remote Branch Verification
- [ ] Verify resume branch exists before container creation (refs: ralph.ts:388-396)
  - Run `git ls-remote --heads origin ${resumeBranch}` on HOST (not container)
  - Fail fast with "ERROR: Branch not found on remote: {branch}" if missing
  - Prevents expensive container setup for invalid resume branch
  - Currently P1.13 mentions verification but not host-side execution

### 1.32 ralph-progress.txt Persistence
- [ ] Ensure ralph-progress.txt persists across iterations (refs: specs/orchestrator.md:215)
  - Location: `/workspace/ralph-progress.txt` in container
  - Purpose: Claude's learning notes across iterations
  - Orchestrator never reads/writes this file (Claude manages it)
  - File remains in container between iterations automatically
  - Document as "hands-off" file in orchestrator

### 1.33 Features.json Directory Creation
- [ ] Ensure .ralph directory exists before file copy (refs: ralph.ts:217-227)
  - Run `mkdir -p /workspace/.ralph` before copying features.json
  - Required for both build mode (features.json) and plan mode (.ralph-prompt.md)
  - Use root user for mkdir, then chown to node

### 1.34 Credential Helper Conditional Setup
- [ ] Only configure gh credential helper if token exists (refs: ralph.ts:196-198)
  - Check if `githubToken` is non-empty before configuring
  - Command: `git config --system credential.helper '!gh auth git-credential'`
  - Skip if no GitHub token (allows SSH-only workflow)

### 1.35 Exit Message with PR View Command
- [ ] Print helpful exit message on completion (refs: ralph.ts:637)
  - `console.log(\`\\nTo view PR: gh pr view ${branch}\`)`
  - Provides immediate next action for user
  - Only show when PR exists (after successful orchestration)

### 1.36 ANTHROPIC_API_KEY Fallback Support
- [ ] Support ANTHROPIC_API_KEY as fallback to CLAUDE_CODE_OAUTH_TOKEN (refs: ralph.ts:358-361, ConfigLive.ts:35-42)
  - Check: `!CLAUDE_CODE_OAUTH_TOKEN && !ANTHROPIC_API_KEY` → error
  - Pass both tokens to container environment (ralph.ts:170-171)
  - Update ConfigLive.ts validation logic (currently only checks OAuth token)
  - Error message: "Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY"

### 1.37 Keep-Alive Command Consistency
- [ ] Reconcile keep-alive command between implementations (refs: ralph.ts:177, DockerLive.ts:80-81, specs/container.md:70)
  - DockerLive.ts uses `tail -f /dev/null` (matches spec)
  - ralph.ts uses `sleep infinity` (divergent)
  - Both work but should be consistent
  - Recommendation: Update ralph.ts to match spec (`tail -f /dev/null`)

### 1.38 Container Cleanup Try-Finally Pattern
- [ ] Implement try-finally cleanup in main.ts (refs: ralph.ts:164-231)
  - Currently no cleanup block in main.ts
  - Add finally block with `DockerService.remove(containerName)`
  - Cleanup should run even on error/signal
  - Use `Effect.ensuring()` or `Effect.acquireRelease()` pattern

### 1.39 Features.json Validation on Startup
- [ ] Validate features.json existence and format before container creation (refs: ralph.ts:371-379, specs/orchestrator.md:16)
  - Check file exists: `Bun.file(featuresPath).exists()`
  - Parse JSON and validate structure
  - Fail fast with clear error if invalid
  - Only required in build mode (not plan mode)
  - ConfigLive.ts currently does not validate this

### 1.40 Pass Args to mainLoop for Loop Control
- [ ] Thread RalphArgs through mainLoop (refs: src/program.ts:283-297, src/args.ts)
  - Current mainLoop signature: `(params: { containerName, prompt })`
  - Needed for: `args.once`, `args.maxIterations`
  - Update signature to include args or individual flags
  - Wire to loop condition at lines 295-297

### 1.41 Volume Mount Completeness Verification
- [ ] Verify all required volume mounts are present (refs: specs/container.md:36-40)
  - `~/.ssh:/root/.ssh:ro` - SSH keys for git operations
  - `~/.claude:/home/node/.claude:ro` - Claude CLI configuration
  - `templates:/workspace/templates:ro` - Template files
  - `.gitconfig` mounted read-only for git configuration
  - Check program.ts:36-40 has all mounts

### 1.42 GIT_COMMITTER_* Environment Variables
- [ ] Add GIT_COMMITTER_NAME and GIT_COMMITTER_EMAIL (refs: specs/container.md, P1.25)
  - Git uses separate committer identity from author
  - Pass `GIT_COMMITTER_NAME=${process.env.GIT_COMMITTER_NAME || 'Ralph'}`
  - Pass `GIT_COMMITTER_EMAIL=${process.env.GIT_COMMITTER_EMAIL || 'ralph@localhost'}`
  - Completes P1.25 (git author defaults)

### 1.43 Validate Git Repository on Host Before Container
- [ ] Check git repository before container creation (refs: specs/orchestrator.md:15)
  - Run `git rev-parse --git-dir` on HOST before container creation
  - Fail fast with "ERROR: Not a git repository" if fails
  - Belongs with P1.6 environment validation
  - Prevents expensive container setup for invalid directory

### 1.44 Verify CAP_NET_ADMIN Is Only Capability
- [ ] Ensure container only has CAP_NET_ADMIN (refs: specs/container.md:228-231)
  - Security requirement: Only grant minimum necessary capability
  - Add `--cap-drop=ALL` to container creation
  - Then add `--cap-add=NET_ADMIN` explicitly
  - Verify no other capabilities in docker create command

### 1.45 UserKnownHostsFile SSH Configuration
- [ ] Add UserKnownHostsFile to SSH command (refs: specs/container.md:213)
  - Extends P1.23: `core.sshCommand "ssh -i /tmp/.ssh/id_rsa -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"`
  - Prevents SSH prompts about known_hosts updates
  - Required for non-interactive git operations

### 1.46 Exit Code Structural Validation (ZFC)
- [ ] Use exit codes for verify_command validation (refs: specs/zfc-architecture.md:94-98, 142-143)
  - verify_command exit 0 = success, non-0 = failure
  - Do NOT parse command output text for success/failure
  - This is architectural principle, affects runIteration logic
  - Orchestrator should only check exit code, not stderr content

### 1.47 Features.json Schema Validation
- [ ] Validate required fields in features.json (refs: specs/features.md:6-19, extends P1.39)
  - Required fields per feature: `id`, `description`, `passes`
  - Optional fields: `verify_command` (NO dependencies field - not in spec schema)
  - Reject invalid schema before container creation
  - Use JSON schema or manual validation

### 1.48 Empty Features Array Handling
- [ ] Handle empty features array gracefully (refs: specs/features.md:249)
  - If features array is empty, exit with message "No features to implement"
  - Don't create container for empty work
  - Different from missing file (that's an error)

### 1.49 Command Injection Protection in ClaudeLive (SECURITY)
- [ ] Escape prompt strings before shell execution (refs: src/layers/ClaudeLive.ts:41, 89)
  - **CRITICAL SECURITY**: Prompt wrapped in double quotes but not escaped
  - Characters like `"`, `$`, backticks could break out and execute arbitrary commands
  - Example attack: `prompt: 'test"; rm -rf /workspace; echo "'`
  - Solution: Use array-based command execution instead of shell string, or escape special chars
  - Affects both `run()` (line 41) and `runWithEvents()` (line 89)

### 1.50 process.env.HOME Validation
- [ ] Validate HOME environment variable before volume mount interpolation (refs: src/program.ts:37-39)
  - If `HOME` undefined, volume mount becomes `undefined/.ssh:/root/.ssh:ro`
  - Causes cryptic Docker creation failure
  - Check `process.env.HOME` exists before creating container
  - Fail fast with clear error: "ERROR: HOME environment variable not set"

### 1.51 CLI Numeric Argument Validation
- [ ] Validate parseInt results for numeric CLI args (refs: src/args.ts:36, 43)
  - `--max-iterations abc` causes `parseInt` to return `NaN`
  - Loop condition `state.iteration < NaN` is always false → infinite loop
  - Same issue with `--dashboard-port`
  - Add `isNaN()` check and exit with error for invalid numbers

### 1.52 getRemainingFeatures Error Handling
- [ ] Wrap getRemainingFeatures in try-catch (refs: src/container.ts:41-44, src/program.ts:237)
  - `JSON.parse()` throws on malformed input
  - No validation that `parsed.features` exists or is an array
  - Crash mid-iteration if features.json corrupted by Claude
  - Return Effect with FeatureError instead of bare values

### 1.53 mainLoop Iteration Error Recovery
- [ ] Handle iteration errors without terminating orchestration (refs: src/program.ts:300-319)
  - Currently any error in `runIteration()` terminates entire orchestration
  - Should catch errors, increment noChangeCount for circuit breaker
  - Emit terminal bell (`\x07`) on failure
  - Continue to next iteration (up to circuit breaker threshold)
  - Pattern from ralph.ts: timeout/failures count toward circuit breaker, don't halt

### 1.54 createSession Cleanup on Failure
- [ ] Add cleanup for partial session creation failures (refs: src/program.ts:23-200)
  - If git clone fails after container created, container is orphaned
  - Wrap in `Effect.acquireRelease()` or `Effect.ensuring()`
  - Cleanup should remove container on any failure in session setup
  - Extends P1.38 but applies within createSession, not just main.ts

### 1.55 Volume Mount Path Corrections
- [ ] Fix volume mount paths and permissions (refs: ralph.ts:167-169 vs program.ts:36-40)
  - SSH: ralph.ts uses `/home/node/.ssh`, program.ts uses `/root/.ssh`
  - Claude dir: ralph.ts uses `:rw` (read-write), program.ts uses `:ro` (read-only)
  - Missing `.gitconfig` mount entirely
  - `.claude` needs write access for session state storage
  - Add: `${process.env.HOME}/.gitconfig:/home/node/.gitconfig:ro`

### 1.56 RALPH_HOME Path Resolution
- [ ] Use import.meta.dir for path resolution (refs: ralph.ts:72, 408, 413)
  - ralph.ts uses `import.meta.dir` for relative paths
  - program.ts uses `process.cwd()` which fails if invoked from different directory
  - Templates and dashboard files must be found relative to script location
  - Pass `RALPH_HOME` to functions that need to resolve paths

### 1.57 One-Hour Safety Timeout
- [ ] Update Claude timeout to 1 hour safety fallback (refs: ralph.ts:46)
  - Current: 10 minutes (program.ts:244)
  - ralph.ts uses 1 hour: "safety fallback (Claude Code handles its own timeouts)"
  - Claude's internal timeouts handle normal cases
  - 1 hour prevents premature kills on complex operations

### 1.58 Timeout Error Detection Fix
- [ ] Fix timeout error tag detection in ClaudeLive (refs: src/layers/ClaudeLive.ts:52-58)
  - Code checks `e._tag === "TimeoutException"`
  - Effect's timeout may use different tag structure
  - Verify actual timeout error tag via testing
  - Update detection logic to match Effect's actual behavior

### 1.59 Exec Exit Code Verification
- [ ] Verify command exit codes in docker exec calls (refs: src/program.ts:79-196)
  - Docker exec returns stdout even on command failure
  - Current code assumes success if no exception thrown
  - Silent failures leave container in invalid state
  - Add exit code checking or use `Effect.filterOrFail`

### 1.60 DashboardError TaggedError Definition
- [ ] Define DashboardError as Data.TaggedError (refs: src/services/Dashboard.ts:4-8)
  - Currently only interface definition exists
  - Not in `/workspace/src/errors/index.ts`
  - Cannot use with `Effect.catchTag()` pattern
  - Add to errors module for consistency with other error types

### 1.61 GitLive Dual-Path Implementation
- [ ] Implement dual-path unpushed detection in GitLive layer (refs: src/layers/GitLive.ts:77-110)
  - P1.19 describes host-side pattern from ralph.ts
  - GitLive.hasUnpushedCommits() needs same dual-path logic
  - If remote branch doesn't exist: return true (new branch = has commits)
  - If remote exists: use standard `git log origin/${branch}..HEAD`

### 1.62 Cap-Drop ALL Security Pattern
- [ ] Add --cap-drop=ALL to container creation (refs: src/layers/DockerLive.ts:49-54)
  - P1.44 identifies requirement but current code only has --cap-add
  - Security best practice: drop all capabilities first
  - Then explicitly add only NET_ADMIN
  - Update DockerLive.create() to include `--cap-drop=ALL`

### 1.63 Template Naming Convention
- [ ] Use correct template file names (refs: ralph.ts:407)
  - Plan mode: `ralph-plan-mode.md`
  - Build mode: `ralph-instructions.md`
  - These are exact filenames expected in `templates/` directory
  - Wire to mode selection in createSession

### 1.64 GitService Container Context (NEW - Jan 2026 Research)
- [ ] GitService operations must run inside container, not on host (refs: src/layers/GitLive.ts, src/program.ts:254)
  - **Current issue**: GitLive.ts uses bare `git` commands that run on HOST git repository
  - program.ts:254 calls `git.hasUnpushedCommits()` expecting container git state
  - **Fix**: Git operations should use `DockerService.exec(containerName, "git ...")` pattern
  - Affects: hasUnpushedCommits(), push(), fetch() when checking container state
  - Alternative: Ensure caller passes correct context (host vs container operations)

### 1.65 listContainersByPrefix for Docker Daemon (NEW - Jan 2026 Research)
- [ ] Add new method for Docker container listing (refs: DockerLive.ts:292-318 vs ralph.ts:137)
  - **CRITICAL**: Current `listByPrefix()` searches filesystem, not Docker daemon
  - Blocks P1.9 startup cleanup - cannot find stale containers
  - Add method: `listContainersByPrefix(prefix: string)` that runs:
    `docker ps -a --filter name=${prefix} --format "{{.Names}}"`
  - Keep existing `listByPrefix(containerName, prefix)` for filesystem operations
  - This is the fix for P6.9 elevated to P1 priority

### 1.66 .claude Directory Write Access (NEW - Jan 2026 Research)
- [ ] Mount .claude directory read-write not read-only (refs: program.ts:39 vs ralph.ts:168)
  - Current: `${process.env.HOME}/.claude:/home/node/.claude:ro` (read-only)
  - Required: `${process.env.HOME}/.claude:/home/node/.claude:rw` (read-write)
  - Claude Code needs write access for session state storage
  - This is a security-functionality tradeoff, but necessary for operation

### 1.67 Docker Image Existence Verification (NEW - Jan 2026 Iteration 4)
- [ ] Verify ralph-base:latest image exists before container creation (refs: program.ts:34)
  - Run `docker images ralph-base:latest --format "{{.Repository}}"` at startup
  - Fail fast with clear error: "ERROR: Docker image ralph-base:latest not found. Run: docker build -t ralph-base:latest -f docker/Dockerfile.base docker/"
  - Prevents cryptic Docker error mid-setup

### 1.68 Heredoc Quoted EOF Security Pattern (NEW - Jan 2026 Iteration 4)
- [ ] Use single-quoted heredoc markers for file writes (refs: ralph.ts:221-223, 507-509)
  - Pattern: `cat << 'EOF'` not `cat << EOF`
  - Single quotes prevent variable expansion and command substitution
  - **SECURITY**: Prevents injection if file content contains `$`, backticks, or `$()`
  - Affects P1.12 (features.json) and P1.15 (prompt template) writes

### 1.69 Feature Slug Sanitization (NEW - Jan 2026 Iteration 4)
- [ ] Sanitize feature names for branch naming (refs: ralph.ts:57)
  - Pattern: `.replace(/[^a-z0-9-]/gi, '-').slice(0, 25)`
  - Removes all non-alphanumeric except hyphens
  - Truncates to 25 characters per spec
  - Required for P1.11 branch name generation

### 1.70 GitHub Token CLI Fallback (NEW - Jan 2026 Iteration 4)
- [ ] Fall back to `gh auth token` if GITHUB_TOKEN not set (refs: ralph.ts:160-161)
  - Pattern: `await Bun.$\`gh auth token\`.text().catch(() => "")`
  - Extends P1.6 environment validation
  - Allows users without GITHUB_TOKEN env var to use authenticated gh CLI

### 1.71 Shell Escaping in Docker Exec Commands (NEW - Jan 2026 Iteration 4)
- [ ] Escape special characters in internal command construction (refs: DockerLive.ts:209, GitLive.ts)
  - Different from P1.49 (prompt injection from external input)
  - Internal commands may include branch names, file paths with special chars
  - Example: branch `feature/test"branch` would break `sh -c "git checkout ${branch}"`
  - Use array-based command construction or proper shell escaping

### 1.72 Thinking Block Filtering for Dashboard (NEW - Jan 2026 Iteration 4)
- [ ] Hide Claude `thinking` content blocks from dashboard display (refs: specs/logging-telemetry.md:166-169)
  - Spec: "Claude's `thinking` content blocks are **hidden by default**. No toggle needed for MVP."
  - Filter out content blocks with `type: "thinking"` before broadcasting to dashboard
  - Still log to JSONL for debugging if needed

### 1.73 server.ts Set Mutation During Iteration (NEW - Jan 2026 Iteration 5)
- [ ] Fix Set.delete() during iteration in server.ts broadcast (refs: src/server.ts:31-40)
  - Current code at line 38 deletes clients while iterating over the Set
  - JavaScript Set iteration behavior with mid-iteration deletion is undefined
  - Fix: Collect failed clients in array, delete after iteration completes
  - Similar to P2.13 for DashboardLive, but this is the legacy server.ts

### 1.74 Stream Reader Lock Release Pattern (NEW - Jan 2026 Iteration 5)
- [ ] Release stdin reader lock in finally block (refs: ralph.ts:109-131)
  - Pattern: `reader.releaseLock()` in finally block after stdin reads
  - Without lock release, subsequent stdin reads may hang
  - Required for P2.5 Interactive CLI Prompts implementation

### 1.75 TextDecoder Stream Option (NEW - Jan 2026 Iteration 5)
- [ ] Use `decoder.decode(value, { stream: true })` for chunked decoding (refs: ralph.ts:269,275)
  - Without `stream: true` option, multi-byte UTF-8 characters split across chunks will corrupt
  - Required for P3.13 NDJSON Buffer Management implementation
  - Critical for international text content in Claude responses

### 1.76 Remaining Buffer Processing After Stream End (NEW - Jan 2026 Iteration 5)
- [ ] Process remaining buffer content after stream ends (refs: ralph.ts:294-302)
  - After ReadableStream completes, check if buffer has remaining content
  - Last line without newline would be lost without this
  - Pattern: `if (buffer.trim()) { try JSON.parse, catch sendOutput }`

### 1.77 Container Restart Exit Code Verification (NEW - Jan 2026 Iteration 5)
- [ ] Verify exit code when restarting container (refs: ralph.ts:148-149)
  - Pattern: `const result = await docker start; return result.exitCode === 0`
  - Without exit code check, container might fail to restart but orchestrator continues
  - Extends P1.10 Container Health Checks with explicit verification

### 1.78 TextDecoder Stream Mode in DockerLive.execStream (NEW - Jan 2026 Iteration 6)
- [ ] Use `decoder.decode(chunk, { stream: true })` in DockerLive.ts:232-233
  - **CRITICAL**: Without `{ stream: true }`, multi-byte UTF-8 characters split across chunks corrupt
  - Affects emoji, CJK characters, international text in Claude output
  - Pattern: `decoder.decode(chunk)` → `decoder.decode(chunk, { stream: true })`
  - Silent data corruption risk in streamed output

### 1.79 parsed.features Property Validation (NEW - Jan 2026 Iteration 6)
- [ ] Validate `parsed.features` exists and is array in container.ts:42-43
  - **CRITICAL**: JSON.parse succeeds but accessing `.features` throws TypeError if missing
  - Examples that would crash: `{}`, `{"features": null}`, `{"feature": []}`
  - Currently throws unhandled TypeError instead of Effect error
  - Return Effect.fail(FeatureError) with descriptive message

### 1.80 Docker Exec Exit Code Capture (NEW - Jan 2026 Iteration 6)
- [ ] Capture and verify exit codes from docker exec in DockerLive.ts:206-218
  - **CRITICAL**: Command.string returns stdout even on non-zero exit codes
  - `docker exec container git push` may fail but returns empty string with exit code 1
  - Current: Returns empty string, caller assumes success
  - Need: Verify exit code or use Command.exitCode pattern

### 1.81 Git Command Injection Prevention (NEW - Jan 2026 Iteration 6)
- [ ] Escape special characters in git commands in GitLive.ts (SECURITY)
  - **CRITICAL**: Branch names, user names, emails interpolated without escaping
  - Line 35: `git checkout ${branch}` - branch name not escaped
  - Line 113: `git checkout -b ${branch}` - branch name not escaped
  - Line 131: `git config user.name "${name}"` - name not escaped
  - Line 135: `git config user.email "${email}"` - email not escaped
  - Attack: branch `main"; rm -rf /workspace; echo "` executes arbitrary commands
  - Distinct from P1.49 (prompt injection from external input) - this is internal command construction

### 1.82 Find Command Injection in listByPrefix (NEW - Jan 2026 Iteration 6)
- [ ] Escape prefix in find command in DockerLive.ts:296 (SECURITY)
  - Pattern: `find /workspace -maxdepth 1 -name '${prefix}*'`
  - If prefix contains single quotes or shell metacharacters, command injection possible
  - Attack: prefix `*' -exec rm -rf {} \; -o -name '` executes destructive commands
  - Use array-based command or proper shell escaping

### 1.83 Error-Tolerant Command Execution Pattern (NEW - Jan 2026 Iteration 6)
- [ ] Add failSafe option for error-tolerant commands (refs: ralph.ts:140,148,487,558)
  - Bun uses `.quiet().nothrow()` modifiers for error-tolerant execution
  - Effect implementation needs equivalent for cleanup ops, PR ready, etc.
  - Pattern: Optional `failSafe: boolean` param that maps failures to Success with exit code
  - Required for: P1.9 (cleanup), P1.20 (PR ready), P1.22 (circuit breaker)

### 1.84 AbortSignal Integration for Claude Cancellation (NEW - Jan 2026 Iteration 6)
- [ ] Accept AbortSignal in ClaudeService.run() options (refs: ralph.ts:245-251)
  - ralph.ts uses `AbortSignal.any([timeoutController.signal, externalSignal])`
  - Combines timeout with dashboard stop button abort
  - Effect implementation needs similar pattern for interruption
  - Required for: P1.16 (AbortController pattern), dual abort sources

### 1.85 Stdin Stream Reader for CLI Prompts (NEW - Jan 2026 Iteration 6)
- [ ] Create stdin reader utility with proper lock management (refs: ralph.ts:109-131)
  - Bun.stdin.stream() provides WHATWG ReadableStream for interactive input
  - **CRITICAL**: Reader lock MUST be released in finally block
  - Pattern: `reader.releaseLock()` in finally to prevent hung subsequent reads
  - Required for: P2.5 (Interactive CLI Prompts), P1.30 (dual input race)

### 1.86 SSH-Only Git Operations Fallback (NEW - Jan 2026 Iteration 6)
- [ ] Ensure git works when only SSH keys available, no GITHUB_TOKEN (refs: specs/networking.md:44-99)
  - Credential helper requires token, but SSH auth is alternate path
  - When GITHUB_TOKEN missing: skip credential helper config, rely on SSH
  - Test scenario: user has SSH keys but no token environment variable

### 1.87 tool_result Content Type Validation (NEW - Jan 2026 Iteration 6)
- [ ] Handle tool_result.content as string or array (refs: specs/claude-integration.md:70-73)
  - Claude API may return `content: string` or `content: ContentBlock[]`
  - Current code assumes string, crashes on array variant
  - Normalize to string for consistent handling

### 1.88 Empty String CLI Argument Handling (NEW - Jan 2026 Iteration 6)
- [ ] Handle empty string arguments correctly in args.ts:29-47
  - `--branch ""` treated as missing argument (empty string is falsy)
  - `if (arg === "--branch" && nextArg)` skips empty strings
  - Should use `nextArg !== undefined` check instead
  - Silent misparse of CLI arguments with empty values

### 1.89 Stream Cancellation Resource Leak in ClaudeLive (NEW - Jan 2026 Iteration 7)
- [ ] Ensure docker exec cleanup on stream interruption (refs: src/layers/ClaudeLive.ts:69-134)
  - `runWithEvents()` creates scoped stream via docker.execStream()
  - If consumer cancels before completion, docker exec process may continue running
  - Verify Effect.scoped at DockerLive.ts:221 handles cleanup
  - Potential zombie docker exec processes accumulating over time

### 1.90 DashboardLive SSE Controller Type Safety (NEW - Jan 2026 Iteration 7)
- [ ] Fix generic type parameter for ReadableStreamDefaultController (refs: src/layers/DashboardLive.ts:17, 120-154)
  - `clientsRef` declared as `Set<ReadableStreamDefaultController>` missing type param
  - Should be `ReadableStreamDefaultController<Uint8Array>` per line 30 usage
  - TypeScript may not catch due to structural typing, runtime behavior undefined

### 1.91 Race Condition in DashboardLive SSE Client Tracking (NEW - Jan 2026 Iteration 7)
- [ ] Ensure atomic client registration in SSE (refs: src/layers/DashboardLive.ts:127-133, 142-152)
  - Multiple clients connecting simultaneously could corrupt clientsRef Set
  - `Effect.runSync(Ref.update(...))` from sync context may break atomicity
  - Could result in lost client connections, missed broadcasts

### 1.92 Feature Array Element Validation (NEW - Jan 2026 Iteration 7)
- [ ] Validate feature elements have required properties (refs: src/container.ts:43-44)
  - `parsed.features.filter((f: { passes: boolean }) => !f.passes)` assumes elements have passes
  - If features.json contains `[null, {}, {"passes": true}]`, filter crashes on null
  - Extends P1.79 - element validation in addition to array existence

### 1.93 Git Root Detection Staleness (NEW - Jan 2026 Iteration 7)
- [ ] Detect stale git root when config cached long-term (refs: src/layers/ConfigLive.ts:14-25)
  - `git rev-parse --show-toplevel` runs once at ConfigLive creation
  - Result cached for entire session, may become stale
  - User changing directory/git state between config creation and container ops

### 1.94 Effect.sleep Duration Type Safety (NEW - Jan 2026 Iteration 7)
- [ ] Use Duration.seconds() instead of string literals (refs: src/program.ts:75)
  - `Effect.sleep("3 seconds")` uses string format with no compile-time validation
  - Invalid formats like "3sec" fail at runtime
  - Use `Duration.seconds(3)` for type safety

### 1.95 Templates Directory Existence Validation (NEW - Jan 2026 Iteration 7)
- [ ] Validate templates/ directory exists before volume mount (refs: src/program.ts:39)
  - `${process.cwd()}/templates:/workspace/templates:ro` mount
  - No check that templates directory exists
  - Cryptic Docker mount error if directory missing

### 1.96 Iteration State Invariants (NEW - Jan 2026 Iteration 7)
- [ ] Validate iteration state machine transitions (refs: src/program.ts:289-321)
  - No validation that iteration always increments by exactly 1
  - No validation that noChangeCount doesn't go negative
  - Could create infinite loop if state transitions break

### 1.97 Double Error Wrapping in DockerLive (NEW - Jan 2026 Iteration 7)
- [ ] Preserve original error information in wrapping (refs: src/layers/DockerLive.ts:87-93)
  - Command errors wrapped in DockerError, but Command may already throw tagged errors
  - Pattern repeated 10+ times, creates nested error objects
  - Original stack trace buried in `cause`, harder to debug

### 1.98 Git History Linearity Assumption (NEW - Jan 2026 Iteration 7)
- [ ] Handle non-linear git histories in unpushed detection (refs: src/layers/GitLive.ts:77-110)
  - `git log origin/branch..HEAD` assumes linear history
  - Merge/rebase workflows may have different commit topology
  - False positives after rebases or complex merges

### 1.99 Dual Dashboard State Risk (NEW - Jan 2026 Iteration 7)
- [ ] Prevent concurrent use of server.ts and DashboardLive (refs: src/server.ts:9-21, src/layers/DashboardLive.ts:9-21)
  - Both files have overlapping functionality with separate state
  - If both imported, two state objects exist, updates don't sync
  - Migrate before risk materializes (related to P2.1)

### 1.100 NDJSON Buffer Pop Pattern (NEW - Jan 2026 Iteration 7)
- [ ] Implement inter-chunk buffer management with lines.pop() (refs: ralph.ts:275-277)
  - Pattern: `buffer = lines.pop() || ""` keeps incomplete line for next chunk
  - Current ndjson.ts may not handle split JSON objects across stream chunks
  - Critical for multi-byte characters split at chunk boundaries

### 1.101 Dual-Mode Claude Spawn Pattern (NEW - Jan 2026 Iteration 7)
- [ ] Implement different spawn patterns based on dashboard state (refs: ralph.ts:254-335)
  - Dashboard mode: `stdout: "pipe"` + NDJSON parsing + `--output-format stream-json`
  - Non-dashboard: `stdout: "inherit"` + NO stream-json flag
  - ClaudeLive.ts always uses stream-json (line 87) - needs conditional logic

### 1.102 Pause Polling Dual Exit Conditions (NEW - Jan 2026 Iteration 7)
- [ ] Implement pause loop with stopping check (refs: ralph.ts:442-449)
  - Pattern: `while (isPaused() && !isStopping())` - checks TWO conditions
  - After loop: `if (isStopping()) break` - stopping takes priority over resume
  - Prevents deadlock where stop requested during pause

### 1.103 Parallel Stream Processing with proc.exited Race (NEW - Jan 2026 Iteration 7)
- [ ] Await stdout, stderr, AND process exit together (refs: ralph.ts:319-323)
  - Pattern: `Promise.all([streamNDJSON(stdout), streamStderr(stderr), proc.exited])`
  - Ensures orchestrator waits for stream draining AND process exit
  - Prevents premature iteration advancement

### 1.104 JSON Parse Fallback to Raw Output (NEW - Jan 2026 Iteration 7)
- [ ] Route failed JSON parses to different channel (refs: ralph.ts:283-289)
  - On parse failure: emit via `sendOutput(line)` not skip
  - Parse failures routed to raw text channel, not discarded
  - Different from P4.11 which says "skip" - actually routes differently

### 1.105 Heredoc Inline in Docker Exec (NEW - Jan 2026 Iteration 7)
- [ ] Document triple-nesting pattern for file writes (refs: ralph.ts:221-223)
  - Pattern: Bun template → bash -c → heredoc
  - Avoids file escaping issues by using heredoc delimiters inside exec
  - Different from DockerService.writeFile() approach

### 1.106 Plan Mode Empty Features Array (NEW - Jan 2026 Iteration 7)
- [ ] Initialize features with empty array for plan mode (refs: ralph.ts:371-379)
  - Plan mode: `featuresData = { features: [] }` is expected, not error
  - Only validate/read features.json in build mode
  - Different from P1.48 which treats empty as error

### 1.107 Dashboard Server Before Container Creation (NEW - Jan 2026 Iteration 7)
- [ ] Start dashboard server before creating container (refs: ralph.ts:412-423)
  - Server starts BEFORE container creation
  - Dashboard lifecycle independent of container lifecycle
  - Initialization sequence: server start → set callbacks → update state

### 1.108 DashboardLive Missing REST Endpoints (NEW - Jan 2026 Iteration 8)
- [ ] Implement REST endpoints in DashboardLive (refs: server.ts:213-300)
  - **CRITICAL**: DashboardLive only has /events SSE endpoint
  - Missing: POST /pause, POST /resume, POST /step-mode, POST /stop
  - Missing: GET /prompt, PUT /prompt, OPTIONS for CORS
  - Without these, dashboard UI cannot pause, resume, stop, or edit prompts
  - server.ts has full implementation; DashboardLive needs migration

### 1.109 onStopCallback Registration for Dashboard Stop Button (NEW - Jan 2026 Iteration 8)
- [ ] Add callback registration mechanism for abort (refs: server.ts:24-28, ralph.ts:415)
  - server.ts has `onStopCallback` variable and `setOnStopCallback()` function
  - ralph.ts calls `setOnStopCallback(abortClaude)` to wire stop button
  - DashboardLive has no mechanism to register external abort callback
  - Required for P1.16 AbortController pattern to connect to dashboard

### 1.110 ClaudeLive stderr Stream Abandoned (NEW - Jan 2026 Iteration 8)
- [ ] Consume stderr stream in ClaudeLive.runWithEvents() (refs: ClaudeLive.ts:94-134)
  - **CRITICAL**: execStream returns stdout AND stderr, only stdout is consumed
  - Unconsumed stderr can cause process to block when buffer fills
  - Pattern: `Promise.all([streamStdout(), streamStderr(), proc.exited])` from ralph.ts:319-323
  - Stderr should be forwarded to dashboard sendOutput or console

### 1.111 GitHub .packages IP Ranges Missing from Firewall (NEW - Jan 2026 Iteration 8)
- [ ] Add .packages field to GitHub IP whitelist (refs: specs/networking.md:37, docker/init-firewall.sh:76)
  - Spec mentions github.com/* which includes packages
  - Current code: `(.web + .api + .git)[]` missing `.packages`
  - Should be: `(.web + .api + .git + .packages)[]`
  - Package downloads from GitHub Packages may be blocked without this

### 1.112 Feature Schema Extended Fields Not Supported (NEW - Jan 2026 Iteration 8)
- [ ] Support additional feature fields from template (refs: templates/ralph-instructions.md:56-67)
  - Template supports: `acceptance`, `verification`, `steps` fields
  - src/types.ts:3-8 only defines: `id`, `description`, `passes`, `verify_command`
  - Add optional fields to Feature interface to match template expectations

### 1.113 Initial SSE Connection Events Incomplete (NEW - Jan 2026 Iteration 8)
- [ ] Send complete initial state on SSE connection (refs: server.ts:136-167)
  - DashboardLive.ts:135-140 sends only state event
  - server.ts sends THREE events: state, iteration, features
  - Missing initial iteration and features events causes stale dashboard display

### 1.114 import.meta.dir vs process.cwd() Path Resolution (NEW - Jan 2026 Iteration 8)
- [ ] Use import.meta.dir for template path resolution (refs: ralph.ts:72, 408, 413)
  - ralph.ts: `const RALPH_HOME = import.meta.dir` (portable, absolute)
  - program.ts:39 uses `process.cwd()` (fragile, can change)
  - Paths break if Ralph invoked from different directory
  - Extends P1.56 with specific pattern recommendation

### 1.115 JSON.parse in Pure Function Without Error Handling (NEW - Jan 2026 Iteration 8)
- [ ] Wrap JSON.parse in getRemainingFeatures (refs: src/container.ts:42)
  - `getRemainingFeatures` is pure function that throws on malformed JSON
  - Error won't be wrapped in Effect error types when called from Effect context
  - Either convert to Effect-returning function or add try-catch

### 1.116 hasUnpushedCommits Error vs Empty Distinction (NEW - Jan 2026 Iteration 8)
- [ ] Distinguish command failure from no commits in GitLive (refs: GitLive.ts:94-109)
  - `git log origin/${branch}..HEAD` fails if remote branch doesn't exist
  - Current: All errors wrapped as GitError, caller can't distinguish
  - Should return distinct result for "command failed" vs "no commits"
  - Affects circuit breaker logic in program.ts:254

### 1.117 DashboardLive Async/Await Mixed with Effect (NEW - Jan 2026 Iteration 8)
- [ ] Refactor Bun.serve callback to use Effect properly (refs: DashboardLive.ts:170)
  - Uses `await file.exists()` mixing async/await with Effect code
  - Errors from file operations won't be caught by Effect error handling
  - Use Effect.tryPromise or Effect.promise for consistency

### 1.118 Command Injection in Git Branch Parameter (NEW - Jan 2026 Iteration 9)
- [ ] Escape branch parameter in git checkout/fetch commands (refs: GitLive.ts:35,47,113)
  - **CRITICAL SECURITY**: Branch name from user input (--branch flag) passed directly to shell
  - `git checkout ${branch}`, `git fetch origin ${branch}`, `git checkout -b ${branch}`
  - Attack: `--branch 'main"; rm -rf /workspace; echo "'` executes arbitrary commands
  - Extends P1.81 - same vulnerability class in different callsites

### 1.119 Command Injection in Git Clone Branch (NEW - Jan 2026 Iteration 9)
- [ ] Escape branch parameter in git clone command (refs: program.ts:82)
  - **CRITICAL SECURITY**: `git clone --branch ${sessionConfig.branch} ${sessionConfig.gitRoot} /tmp/repo`
  - Both branch and gitRoot parameters can contain shell metacharacters
  - Attack: `--branch '--upload-pack=rm -rf /' trunk` could exploit git options
  - Distinct from P1.118 - git clone has different option attack surface

### 1.120 Exec Scoped Stream Resource Leak (NEW - Jan 2026 Iteration 9)
- [ ] Fix Effect.scoped in DockerLive.execStream (refs: DockerLive.ts:221-243)
  - Returns streams wrapped in `Effect.scoped`, but scope released when Effect completes
  - If consumer gets Effect but never runs streams, docker exec process leaks
  - Pattern: Scope cleanup ≠ stream consumption completion
  - Need acquireRelease pattern or ensure streams consumed before scope exits

### 1.121 parseInt NaN maxIterations Loop Bug (NEW - Jan 2026 Iteration 9)
- [ ] Validate parseInt result for maxIterations (refs: args.ts:36, program.ts:295-297)
  - `parseInt("invalid", 10)` returns NaN
  - Loop condition `state.noChangeCount < 3` has no NaN check
  - `NaN < 3` is false → loop body never executes
  - Extends P1.51 - specific failure mode causing silent no-op

### 1.122 parseInt NaN dashboardPort Server Error (NEW - Jan 2026 Iteration 9)
- [ ] Validate parseInt result for dashboardPort (refs: args.ts:43)
  - `parseInt("invalid", 10)` returns NaN
  - Bun.serve at DashboardLive.ts:113 tries to bind to port NaN
  - Cryptic error: "Failed to start server" without clear cause
  - Different failure mode than P1.121 - server startup vs loop

### 1.123 Container State Verification After Firewall Wait (NEW - Jan 2026 Iteration 9)
- [ ] Verify container running after firewall sleep (refs: program.ts:75-76)
  - After `Effect.sleep("3 seconds")`, immediately calls git clone
  - If container crashed during entrypoint.sh, sleep completes but clone fails
  - No verification that container is still running before proceeding
  - Different from P1.10 (iteration-level check) - this is startup sequence

### 1.124 createSession Partial Failure Container Leak (NEW - Jan 2026 Iteration 9)
- [ ] Add cleanup for partial createSession failures (refs: program.ts:23-200)
  - If git clone fails after container created, container orphaned
  - If firewall wait times out, container orphaned
  - Need Effect.ensuring or acquireRelease within createSession, not just main.ts
  - Extends P1.54 - applies within session creation, not just main

### 1.125 Initial remainingFeaturesCount Logic Bug (NEW - Jan 2026 Iteration 9)
- [ ] Fix initial state in mainLoop (refs: program.ts:291)
  - Initial state: `{ iteration: 0, noChangeCount: 0, remainingFeaturesCount: 0 }`
  - `remainingFeaturesCount: 0` is wrong - should be unknown until first iteration
  - Loop condition `state.remainingFeaturesCount > 0` would incorrectly exit on iteration 0
  - Works by accident due to `iteration === 0` guard - fragile logic

### 1.126 CircuitBreaker Check After Loop Timing (NEW - Jan 2026 Iteration 9)
- [ ] Move circuit breaker check into loop condition (refs: program.ts:324-330)
  - Check happens AFTER loop completes: `if (finalState.noChangeCount >= 3)`
  - If loop exits due to features completing, check never triggers error
  - CircuitBreakerError only thrown if loop exits for OTHER reason with high noChangeCount
  - Should be checked at end of each iteration, not after entire loop

### 1.127 Path Traversal in readFile/writeFile Operations (NEW - Jan 2026 Iteration 10)
- [ ] Validate file paths stay within /workspace boundary (refs: DockerLive.ts:244-288) (SECURITY)
  - **CRITICAL**: File paths passed directly to `cat` and `tee` commands without validation
  - Attack: `path = "../../../../etc/passwd"` could read host files if container escape occurs
  - Attack: `path = "/workspace/.ralph/../../../etc/shadow"` path traversal
  - Add validation that normalized path starts with `/workspace/`

### 1.128 Missing containerName Parameter Validation (NEW - Jan 2026 Iteration 10)
- [ ] Validate containerName matches expected pattern before interpolation (refs: DockerLive.ts:209,247) (SECURITY)
  - Container name from external sources interpolated into docker commands
  - Attack: `containerName = "test; rm -rf /"` could inject commands
  - Add regex validation: `/^ralph-[a-zA-Z0-9-]+$/`
  - generateContainerName() creates safe names but no validation on consumption

### 1.129 Unvalidated JSON.stringify in SSE Broadcasts (NEW - Jan 2026 Iteration 10)
- [ ] Sanitize event data before SSE broadcast (refs: DashboardLive.ts:26-34) (SECURITY)
  - Dashboard state serialized without sanitization, broadcast to all clients
  - If `event` contains malicious strings from features.json (user-controlled)
  - Potential for prototype pollution via `__proto__` in JSON
  - XSS risk if dashboard client doesn't sanitize received events

### 1.130 Unhandled Async Errors in DashboardLive Fetch Handler (NEW - Jan 2026 Iteration 10)
- [ ] Add try-catch wrapper for async fetch handler (refs: DashboardLive.ts:115-176)
  - `async fetch()` handler can throw unhandled promise rejections
  - Malformed request URL crashes server: `new URL(req.url)` can throw
  - Filesystem errors during `file.exists()` unhandled
  - No error boundary, exceptions bubble to Bun.serve

### 1.131 Effect.runSync in Async Context Deadlock Risk (NEW - Jan 2026 Iteration 10)
- [ ] Replace Effect.runSync with Effect.runPromise in SSE handlers (refs: DashboardLive.ts:127-152)
  - `Effect.runSync()` called from async SSE stream handlers
  - If Effect requires async resources, `runSync()` blocks
  - Called from `ReadableStream.start()` which expects sync completion
  - No timeout protection, potential infinite hang

### 1.132 features.filter Type Check (NEW - Jan 2026 Iteration 10)
- [ ] Validate features is array before calling filter (refs: container.ts:41-44)
  - Extends P1.79 - different failure mode: wrong type instead of missing property
  - `{"features": "not an array"}` → `.filter()` throws TypeError
  - `{"features": 123}` → not iterable
  - Error: "features.filter is not a function"

### 1.133 SSE Client Controller Memory Leak on Error (NEW - Jan 2026 Iteration 10)
- [ ] Remove failed SSE clients immediately in catch block (refs: DashboardLive.ts:120-154)
  - Comment says "removed on next cleanup" but no cleanup exists
  - Failed controllers accumulate in Set indefinitely
  - Each broadcast iterates over dead controllers
  - Fix: Delete from Set immediately in catch block, not "later"

### 1.134 Docker Exec Process Leak on Stream Parse Error (NEW - Jan 2026 Iteration 10)
- [ ] Ensure docker exec cleanup on parseNDJSON error (refs: DockerLive.ts:220-243, ClaudeLive.ts:116)
  - Extends P1.89/P1.120 - identifies specific failure path
  - If parseNDJSON() errors during stream consumption, docker exec may continue
  - `Effect.scoped` completes but underlying process not killed
  - Zombie `docker exec` processes accumulate over time

### 1.135 ConfigLive detectGitRoot Missing BunContext (NEW - Jan 2026 Iteration 10)
- [ ] Add Effect.provide(BunContext.layer) to detectGitRoot (refs: ConfigLive.ts:14-25)
  - `detectGitRoot` runs `git rev-parse` without BunContext.layer
  - Depends on layer being provided by caller (makeConfigLive)
  - If called standalone, throws "no provider for CommandExecutor"
  - All other Command usages include `.pipe(Effect.provide(BunContext.layer))`

### 1.136 GitLive hasUnpushedCommits Fails on Detached HEAD (NEW - Jan 2026 Iteration 10)
- [ ] Handle detached HEAD state in unpushed detection (refs: GitLive.ts:77-110)
  - `git branch --show-current` returns empty string on detached HEAD
  - Command becomes `git log origin/..HEAD` - invalid syntax
  - Fails with GitError instead of returning false
  - Can occur during container setup race conditions

### 1.137 mainLoop Circuit Breaker Off-By-One Logic (NEW - Jan 2026 Iteration 10)
- [ ] Remove redundant post-loop circuit breaker check (refs: program.ts:295-297, 324-330)
  - Loop exits when `noChangeCount` reaches 3 (due to `< 3` condition)
  - Then check `>= 3` always true when loop exits via circuit breaker
  - But if loop exits for other reasons, `noChangeCount` could be 0,1,2
  - Redundant check, confusing code

### 1.138 ConfigLive GITHUB_TOKEN Empty String vs Undefined (NEW - Jan 2026 Iteration 10)
- [ ] Use undefined instead of empty string for missing token (refs: ConfigLive.ts:45-47)
  - Token defaults to empty string instead of undefined
  - Empty string vs undefined has different semantics
  - `if (githubToken)` works accidentally (empty string is falsy)
  - Better pattern: Use `string | undefined` type, return `undefined` on missing

### 1.139 SSH Volume Mount Path Mismatch (NEW - Jan 2026 Iteration 10)
- [ ] Fix SSH key mount path to match entrypoint.sh expectation (refs: program.ts:37, entrypoint.sh:15-17)
  - **CRITICAL**: program.ts mounts `~/.ssh:/root/.ssh:ro`
  - entrypoint.sh looks for `/home/node/.ssh` and copies to `/tmp/.ssh/`
  - SSH keys never found because mounted to wrong location
  - Fix: Change mount to `~/.ssh:/home/node/.ssh:ro`

### 1.140 Missing .gitconfig Volume Mount (NEW - Jan 2026 Iteration 10)
- [ ] Add .gitconfig volume mount to program.ts (refs: program.ts:36-40, ralph.ts:169)
  - ralph.ts mounts `~/.gitconfig:/home/node/.gitconfig:ro`
  - program.ts only mounts .ssh, .claude, and templates
  - User's git configuration not available inside container
  - Add: `${process.env.HOME}/.gitconfig:/home/node/.gitconfig:ro`

### 1.141 Container Name Format Mismatch (NEW - Jan 2026 Iteration 10)
- [ ] Align container name generation with cleanup filter pattern (refs: container.ts:20, ralph.ts:137)
  - generateContainerName() produces `ralph-session-${id}` format
  - ralph.ts filters for `ralph-session` prefix in cleanup
  - Inconsistent patterns may cause cleanup to miss stale containers
  - Verify filter matches actual container name format

### 1.142 Git Clone SSH Key Path Conflict (NEW - Jan 2026 Iteration 10)
- [ ] Ensure SSH config points to correct key path after entrypoint.sh runs (refs: program.ts:153-167, entrypoint.sh:16-20)
  - program.ts configures SSH to use `/tmp/.ssh/id_rsa`
  - This path only exists after entrypoint.sh copies keys from /home/node/.ssh
  - But P1.139 shows program.ts mounts to /root/.ssh, not /home/node/.ssh
  - Complete SSH chain is broken: wrong mount → no copy → no key at /tmp/.ssh

### 1.143 Environment Variable Injection in Docker Volume Mounts (NEW - Jan 2026 Iteration 11)
- [ ] Validate HOME environment variable before volume mount interpolation (refs: program.ts:37-38) (SECURITY)
  - **HIGH SEVERITY**: `process.env.HOME` directly interpolated without validation
  - Attack: Setting `HOME=/etc` before running Ralph exposes sensitive system files
  - Volume mounts are read-only which limits damage but still exposes sensitive data
  - Fix: Validate HOME is safe path within expected user directories

### 1.144 Shell Injection in ralph.ts Docker Create (NEW - Jan 2026 Iteration 11)
- [ ] Escape environment variables in Docker create command (refs: ralph.ts:164-177) (SECURITY)
  - **HIGH SEVERITY**: Multiple env vars interpolated without escaping in Bun template
  - `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` could contain shell metacharacters
  - Attack: `GIT_AUTHOR_NAME='Alice"; docker exec... ; echo "'` breaks out of -e flag
  - Fix: Use array-based command or escape all env values

### 1.145 Race Condition in Firewall Initialization (NEW - Jan 2026 Iteration 11)
- [ ] Replace hardcoded 3-second sleep with actual firewall detection (refs: program.ts:75) (SECURITY)
  - **MEDIUM SEVERITY**: 3-second sleep may not be enough on slow systems
  - Network operations could execute before firewall rules applied
  - Claude could access blocked domains during race window
  - Fix: Implement log streaming as TODO suggests

### 1.146 GitHub API Response Injection Risk (NEW - Jan 2026 Iteration 11)
- [ ] Validate GitHub API response before firewall configuration (refs: docker/init-firewall.sh:57) (SECURITY)
  - **MEDIUM SEVERITY**: curl response passed directly to jq without schema validation
  - MITM attack before firewall applied could inject malicious IP ranges
  - Fix: Add TLS verification, validate JSON schema, bundle known-good IP fallback

### 1.147 Path Traversal in Dashboard Static File Serving (NEW - Jan 2026 Iteration 11)
- [ ] Sanitize pathname before file serving (refs: DashboardLive.ts:167-168) (SECURITY)
  - **MEDIUM SEVERITY**: filePath from URL pathname concatenated without sanitization
  - Attack: `/../../../etc/passwd` could read files outside dashboard directory
  - Distinct from P1.127 which covers readFile/writeFile, not static serving
  - Fix: Remove `..` sequences, validate path starts with `/`

### 1.148 Unvalidated Session ID in Container Name Generation (NEW - Jan 2026 Iteration 11)
- [ ] Validate sessionId parameter in generateContainerName (refs: container.ts:19-20) (SECURITY)
  - **MEDIUM SEVERITY**: sessionId parameter directly interpolated without validation
  - API contract allows malicious input even if current usage is safe
  - Attack: `sessionId = "test; rm -rf /"` if passed to shell commands
  - Fix: Validate against regex `^[a-zA-Z0-9-]+$`

### 1.149 Dashboard Broadcast Missing in Orchestration Loop (NEW - Jan 2026 Iteration 11)
- [ ] Wire DashboardService to mainLoop for state updates (refs: specs/orchestrator.md:244, program.ts:214-335)
  - **CRITICAL**: program.ts has no DashboardService imports or calls
  - Dashboard receives no iteration progress updates
  - Spec requires: DashboardService.updateState(), DashboardService.broadcast()
  - Blocks real-time dashboard functionality

### 1.150 Error Recovery Strategy Not Implemented (NEW - Jan 2026 Iteration 11)
- [ ] Implement error-specific recovery with retry/continue (refs: specs/orchestrator.md:231-233, program.ts:214-266)
  - **CRITICAL**: Spec defines recoverable errors with specific behaviors
  - DockerError: retry with backoff
  - TimeoutError: continue to next iteration
  - GitError: log and continue
  - Current program.ts has no retry logic, errors terminate loop

### 1.151 Dashboard State running=false in Cleanup (NEW - Jan 2026 Iteration 11)
- [ ] Update dashboard state to running=false in cleanup (refs: specs/orchestrator.md:49-50, main.ts)
  - Spec requires cleanup flow to update dashboard state
  - main.ts has no dashboard state management
  - Affects P1.149 - part of dashboard integration gap

### 1.152 Step Mode Checkpoint Not in mainLoop (NEW - Jan 2026 Iteration 11)
- [ ] Add step mode pause/resume logic to mainLoop (refs: specs/orchestrator.md:147-152, program.ts:300-319)
  - Spec requires pausing after each iteration when step mode enabled
  - CLI prompt or dashboard resume expected
  - Current mainLoop has no step mode checkpoint logic
  - Elevating from P2.3 as critical for orchestration completeness

### 1.153 Structured Error Handling with catchTag Missing (NEW - Jan 2026 Iteration 11)
- [ ] Use Effect.catchTags instead of catchAll in main.ts (refs: specs/orchestrator.md:223-234, main.ts:64)
  - Spec requires typed error channels with catchTag pattern matching
  - Current main.ts uses catchAll which loses type information
  - Cannot discriminate fatal vs recoverable errors
  - Fix: Add specific catchTags for each error type

### 1.154 Iteration State Missing containerName (NEW - Jan 2026 Iteration 11)
- [ ] Add containerName to Effect.iterate state object (refs: specs/orchestrator.md:207-210, program.ts:291)
  - Spec shows orchestrator state includes containerName
  - Current state: `{ iteration, noChangeCount, remainingFeaturesCount }`
  - Container name passed as parameter but not tracked in state

---

## Priority 2: Dashboard Integration

### 2.1 Remove Legacy server.ts
- [ ] Migrate remaining functionality from server.ts to DashboardLive
  - server.ts uses global mutable state (lines 6-21)
  - DashboardLive uses Effect.Ref for state management
  - Consolidate to single implementation

### 2.2 Connect Dashboard to Effect Orchestration
- [ ] Integrate DashboardLive with mainLoop (refs: src/main.ts, src/server.ts, src/program.ts)
  - server.ts has standalone SSE server not connected to Effect services
  - DashboardService methods defined but not called from mainLoop
  - Wire iteration progress, feature status, Claude events to dashboard

### 2.3 Step Mode in Orchestration Loop
- [ ] Implement step mode pause/resume in mainLoop (refs: src/program.ts:283-335, src/types.ts:10-22)
  - stepMode flag exists in DashboardState and ConfigService
  - mainLoop needs to yield between iterations when stepMode enabled
  - Check `dashboard.getState().stepMode` at start of each iteration
  - Pause and wait for user input or dashboard resume
  - Implement pause/resume polling pattern (ralph.ts:442-449): poll isPaused() with 500ms sleep
  - After resume: `updateState({ paused: false })` (ralph.ts:597)

### 2.4 Prompt Template Editing
- [ ] Wire prompt template editing to mainLoop (refs: src/server.ts:266-280)
  - GET/PUT /prompt endpoints exist in server.ts
  - Not connected to actual prompt used in runIteration
  - Read template from DashboardState or file system

### 2.5 Interactive CLI Prompts (Step Mode)
- [ ] Implement CLI prompt for step mode without dashboard (refs: ralph.ts:106-132)
  - `promptForAction()` function for async stdin/stdout interaction
  - After each iteration when stepMode enabled and NOT using dashboard
  - Show prompt: `[c]ontinue, [s]top` with default continue on empty
  - Race CLI input against dashboard resume when both active (ralph.ts:579-596)
  - Use `Promise.race([promptForAction(), waitForResume()])` pattern
  - Required for step-by-step debugging without browser

### 2.6 Plan Mode Iteration Reporting
- [ ] Report correct iteration counts in plan mode (refs: ralph.ts:500)
  - Plan mode reports `maxIterations: 1` to dashboard (not CLI value)
  - Reports `remaining: 0` since plan mode has no features to track
  - Pattern: `updateIteration(iteration, 1, 0)` for plan mode

### 2.7 Dashboard Port Availability Check
- [ ] Verify port is available before starting server (refs: specs/orchestrator.md:181)
  - Default port 3847, configurable via --dashboard-port
  - Check port availability before Bun.serve()
  - Fail with clear error: "Port {port} is already in use"
  - Suggest alternative or use --dashboard-port flag

### 2.8 Static File Serving Path Verification
- [ ] Verify dashboard/dist/ exists before serving (refs: specs/dashboard.md:207-209)
  - Check if `dashboard/dist/` directory exists
  - If missing, show helpful error about building dashboard
  - Or skip static file serving with warning

### 2.9 ZFC Compliance Audit of Existing Code
- [ ] Audit code for ZFC violations (refs: specs/zfc-architecture.md:261-280)
  - Scan for keywords: "includes", "match", "detect", "analyze", "quality"
  - Verify all decisions use structured data (features.json, exit codes)
  - No heuristic classification based on text content
  - Document any borderline cases

### 2.10 SSH Key Existence Warning
- [ ] Warn if ~/.ssh directory missing on host (refs: specs/container.md:202-207)
  - Check if `~/.ssh` exists before container creation
  - If missing, warn: "WARNING: ~/.ssh not found - git operations may fail"
  - Continue (not fatal) as SSH might not be needed

### 2.11 DashboardLive Error Type Alignment
- [ ] Fix DashboardLive methods to return correct error type (refs: src/layers/DashboardLive.ts)
  - All methods return `Effect.Effect<T, never>` but interface declares `Effect.Effect<T, DashboardError>`
  - Methods using `Ref.get/update` cannot fail with DashboardError
  - Either change interface to `never` or add error mapping
  - Affects: getState, updateState, setPaused, setRunning, etc. (14+ methods)

### 2.12 Effect.runSync Usage in DashboardLive
- [ ] Remove Effect.runSync from Bun.serve callbacks (refs: src/layers/DashboardLive.ts:127-133, 136, 145-151)
  - Uses synchronous Effect execution inside async fetch handlers
  - Breaks Effect execution model - errors throw instead of being handled
  - Refactor to use proper async Effect execution or store reference to runtime

### 2.13 Stale SSE Client Cleanup
- [ ] Implement cleanup mechanism for disconnected SSE clients (refs: src/layers/DashboardLive.ts:28-34)
  - Comment says "will be removed on next cleanup" but no cleanup exists
  - Failed clients accumulate in clientsRef Set
  - Causes exceptions on every broadcast
  - Add periodic cleanup or track failures and remove after threshold

### 2.14 Dashboard State Initialization Sequence
- [ ] Document and implement correct dashboard init sequence (refs: ralph.ts:412-423)
  - 1. `startDashboardServer(port, path)` - Start HTTP server
  - 2. `setOnStopCallback(abortClaude)` - Wire stop button
  - 3. `setPromptTemplate(instructions)` - Set template state
  - 4. `setStepMode(step)` - Initialize from CLI flag
  - 5. `updateState({ running: true, containerName, branch })` - Set initial state
  - Order matters for proper state before first iteration

### 2.15 Container Name in Dashboard State
- [ ] Store containerName and branch in dashboard state (refs: ralph.ts:420)
  - Allows dashboard to display which container is running
  - Allows dashboard to display which branch is being worked on
  - Add fields to DashboardState type and initialization

### 2.16 No-Dashboard Mode Behavior
- [ ] Implement graceful no-dashboard mode (refs: specs/dashboard.md:280-284)
  - When `--dashboard` not specified:
  - Server not started
  - State updates become no-ops
  - All output to console only
  - Current code may fail if dashboard methods called without server

### 2.17 Code Syntax Highlighting in Tool Calls (NEW - Jan 2026 Iteration 6)
- [ ] Auto-detect file language and apply syntax highlighting (refs: specs/logging-telemetry.md:127-135)
  - Dashboard should render tool_use content with language-based highlighting
  - Auto-detect TypeScript, JSON, shell, Python, etc. from file extension
  - Improves readability of code-heavy tool outputs

### 2.18 Collapsible Tool Call Expansion (NEW - Jan 2026 Iteration 6)
- [ ] Implement expand/collapse UI for tool calls (refs: specs/logging-telemetry.md:152-158)
  - Each tool call shows one-line summary by default
  - Example: "Read src/foo.ts:1-50" expands to show file content
  - Reduces visual clutter while preserving detail access

### 2.19 Table Rendering for Tool Outputs (NEW - Jan 2026 Iteration 6)
- [ ] Detect and render table-like data structures (refs: specs/logging-telemetry.md:139-149)
  - When tool output is table-like JSON, render as formatted table
  - Better than raw JSON for structured data visualization

### 2.20 Task Tool Timing Visualizer (NEW - Jan 2026 Iteration 6)
- [ ] Display elapsed time counter for Task tool invocations (refs: specs/logging-telemetry.md:183-227)
  - Show "⏳ Task: prompt (elapsed Xs)" with running timer
  - Track tool_use start, update timer, stop when tool_result arrives
  - Part of subagent tracking feature

### 2.21 Iteration Display Format (NEW - Jan 2026 Iteration 7)
- [ ] Implement consistent iteration progress output (refs: ralph.ts:454-496)
  - Format: "=== Iteration X/Y ===" banner
  - Separate line: "N features remaining" (build mode)
  - Plan mode shows: "Running planning analysis..." instead
  - User-facing output format for progress tracking

### 2.22 Final Verification Console Messages (NEW - Jan 2026 Iteration 7)
- [ ] Display two-stage completion messages (refs: ralph.ts:484-494)
  - First pass: "All features complete! Running final verification iteration..."
  - Second pass: "All features complete and verified!"
  - Explicit messaging that one more iteration happens even when features complete

### 2.23 Exit Message with gh Command (NEW - Jan 2026 Iteration 7)
- [ ] Print PR view command on exit (refs: ralph.ts:637)
  - Format: "\\nTo view PR: gh pr view {branch}"
  - Provides ready-to-run command for next step
  - Always shown regardless of PR existence

### 2.24 SubagentTracker Interface (NEW - Jan 2026 Iteration 7)
- [ ] Define SubagentTracker for Task tool visibility (refs: specs/logging-telemetry.md:210-217)
  - Interface not defined in codebase
  - Correlate tool_use ID with tool_result
  - Track start time, elapsed time, completion status

### 2.25 Static File MIME Type Handling (NEW - Jan 2026 Iteration 8)
- [ ] Add MIME type mapping to DashboardLive static file serving (refs: server.ts:176-210)
  - server.ts has MIME_TYPES map for .html, .css, .js, .json, .png, .jpg, .svg, .ico
  - DashboardLive serves files without proper Content-Type headers
  - Dashboard assets may not load correctly in browsers

### 2.26 Helpful 404 Error for Missing Dashboard Build (NEW - Jan 2026 Iteration 8)
- [ ] Add build instructions in 404 response (refs: server.ts:206-208)
  - server.ts: "Dashboard not found. Run: cd dashboard && bun install && bun run build"
  - DashboardLive returns generic "Not Found"
  - Guides users to fix missing dashboard build

### 2.27 distDir Path Normalization (NEW - Jan 2026 Iteration 8)
- [ ] Normalize dashboard path to extract distDir (refs: server.ts:214-215)
  - Pattern: `dashboardPath.replace(/\/index\.html$/, "")`
  - Handles case where path includes index.html
  - DashboardLive.ts:168 concatenates paths directly

### 2.28 POST /rerun Endpoint Implementation (NEW - Jan 2026 Iteration 8)
- [ ] Add /rerun endpoint for iteration re-runs (refs: specs/logging-telemetry.md:245-255)
  - Accept modified prompt in request body
  - Re-run as iteration N+1 on same branch
  - Related to P3.19 but specific endpoint implementation

### 2.29 GET /iterations Endpoint Implementation (NEW - Jan 2026 Iteration 8)
- [ ] Add /iterations endpoint for sidebar recovery (refs: specs/logging-telemetry.md:273-283)
  - Return IterationsResponse with iteration list and metrics
  - Enables browser to recover iteration sidebar state on reconnect

### 2.30 GET /logs/:iteration Endpoint Implementation (NEW - Jan 2026 Iteration 8)
- [ ] Add /logs/:iteration endpoint for log replay (refs: specs/logging-telemetry.md:282-283)
  - Return raw JSONL events for specific iteration
  - Required for loading historical iteration logs

### 2.31 Dashboard OPTIONS CORS Handling (NEW - Jan 2026 Iteration 9)
- [ ] Add CORS pre-flight handling for cross-origin requests (refs: specs/dashboard.md:272)
  - OPTIONS endpoint needed for browser CORS pre-flight
  - May be auto-handled by Bun.serve but not verified
  - Required for dashboard running on different port than orchestrator

### 2.32 SSE Broadcast Backpressure Handling (NEW - Jan 2026 Iteration 9)
- [ ] Add backpressure handling for slow SSE clients (refs: DashboardLive.ts:28-34)
  - Current: Broadcasts to all clients synchronously in for loop
  - If one client is slow (network lag), enqueue blocks entire broadcast
  - Other clients experience delayed events
  - Pattern: Use async iteration or queue per client

### 2.33 Overly Broad Error Suppression in Broadcast (NEW - Jan 2026 Iteration 9)
- [ ] Narrow catch clause in SSE broadcast (refs: DashboardLive.ts:29-32)
  - Current: `try { ... } catch { // silent }`
  - Catches ALL exceptions, not just client disconnect
  - If TextEncoder throws (invalid data), JSON.stringify throws (circular ref), errors silently swallowed
  - Should catch specific error types or at least log others

### 2.34 Missing Iteration Sidebar UI Component (NEW - Jan 2026 Iteration 10)
- [ ] Create iteration sidebar component per spec (refs: App.tsx:84-100, specs/logging-telemetry.md:20-33)
  - Current layout has only "Features" sidebar, no iteration sidebar
  - Spec shows two-panel layout: "Iteration Sidebar" + "Activity Panel"
  - Each iteration card should display: Title, status indicator, token count, context %
  - No IterationSidebar.tsx component exists in dashboard/src/components/

### 2.35 Tool Calls Expanded by Default (NEW - Jan 2026 Iteration 10)
- [ ] Change tool_use block default to expanded (refs: ActivityLog.tsx:74, specs/logging-telemetry.md:113-124)
  - Current: Sets `expanded: false` for tool_use blocks
  - Spec: "All tool_use events display expanded, with a collapse button"
  - Opposite behavior from spec requirement

### 2.36 Hide Thinking Blocks Completely (NEW - Jan 2026 Iteration 10)
- [ ] Remove thinking block rendering entirely (refs: ActivityLog.tsx:51-59, specs/logging-telemetry.md:166-169)
  - Current: Creates DisplayItem for thinking blocks with truncated preview
  - Spec: "Claude's thinking content blocks are hidden by default. No toggle needed for MVP"
  - Thinking blocks should not be rendered at all, not collapsed

### 2.37 Syntax Highlighting for Tool Output (NEW - Jan 2026 Iteration 10)
- [ ] Add language-aware syntax highlighting (refs: ActivityLog.tsx:234-238, specs/logging-telemetry.md:127-138)
  - Current: Tool details rendered in plain `<pre>` with no highlighting
  - Spec: Auto-detect language from file extension, apply Prism.js or highlight.js
  - No highlighting library imported in dashboard package

### 2.38 Prompt Display at Iteration Start (NEW - Jan 2026 Iteration 10)
- [ ] Display prompt sent to Claude in activity panel header (refs: ActivityLog.tsx, specs/logging-telemetry.md:170-181)
  - No logic to extract or display prompts
  - Spec shows formatted box at top of activity log showing iteration prompt
  - Required for iteration debugging and prompt tuning workflow

### 2.39 /logs/:iteration Endpoint (NEW - Jan 2026 Iteration 10)
- [ ] Implement JSONL retrieval for specific iteration (refs: server.ts, DashboardLive.ts, specs/logging-telemetry.md:42)
  - Neither server.ts nor DashboardLive.ts implement this endpoint
  - Required for dashboard state recovery on browser refresh
  - Return JSONL events for specific iteration

### 2.40 /iterations Endpoint (NEW - Jan 2026 Iteration 10)
- [ ] Implement iteration list with metrics (refs: specs/logging-telemetry.md:273-279)
  - Neither implementation has this endpoint
  - Required for populating iteration sidebar after browser reconnect
  - Return IterationsResponse interface with iterations array

### 2.41 /rerun Endpoint (NEW - Jan 2026 Iteration 10)
- [ ] Implement re-run iteration with modified prompt (refs: specs/logging-telemetry.md:245-254)
  - Neither implementation has this endpoint
  - Critical for prompt tuning workflow
  - Accept modified prompt, create new iteration N+1

### 2.42 Subagent Task Tool Timing Tracker (NEW - Jan 2026 Iteration 10)
- [ ] Add elapsed time display for Task tool invocations (refs: ActivityLog.tsx:68-79, specs/logging-telemetry.md:189-227)
  - Task tool treated same as other tools, no special handling
  - Spec shows "⏳ Task: ... (42s elapsed)" during execution
  - Requires tracking tool_use event start time, updating UI during execution

### 2.43 Session Recovery on Browser Refresh (NEW - Jan 2026 Iteration 10)
- [ ] Implement browser-side state recovery (refs: useSSE.ts:13-36, specs/logging-telemetry.md:260-270)
  - Browser refresh loses all iteration history and activity log state
  - Only connects to SSE, no recovery logic
  - Requires P2.39, P2.40, plus browser-side recovery hook

### 2.44 IterationMetrics Interface in Types (NEW - Jan 2026 Iteration 10)
- [ ] Define IterationMetrics interface (refs: types.ts, specs/logging-telemetry.md:92-102)
  - Type not defined despite being core to logging spec
  - Fields: iteration, status, inputTokens, outputTokens, totalTokens, contextPercent, duration
  - Blocks iteration sidebar display and /iterations endpoint

### 2.45 iteration_start Event Type (NEW - Jan 2026 Iteration 10)
- [ ] Add iteration_start to DashboardEvent union (refs: types.ts:70, specs/logging-telemetry.md:72-77)
  - DashboardEvent missing iteration_start event type
  - Required for splitting JSONL logs by iteration
  - Schema: `{"type":"iteration_start","iteration":3,"timestamp":"..."}`

### 2.46 Claude Event Token Data Extraction (NEW - Jan 2026 Iteration 10)
- [ ] Extract token usage from ClaudeResultEvent for metrics (refs: ActivityLog.tsx:81-93, types.ts:106-111)
  - Token data present in events but never aggregated or displayed
  - ClaudeMessageEvent.message.usage contains input_tokens, output_tokens
  - Required for IterationMetrics totalTokens and contextPercent

### 2.47 .ralph/sessions Directory Structure (NEW - Jan 2026 Iteration 10)
- [ ] Create session logging directory structure (refs: specs/logging-telemetry.md:56)
  - Session logging directory doesn't exist and isn't created
  - Logs stored as `.ralph/sessions/{session-id}.jsonl`
  - No code creates directory or maps session ID to filename

### 2.48 SSE Error Reconnection Fix (NEW - Jan 2026 Iteration 10)
- [ ] Fix EventSource recreation in error handler (refs: useSSE.ts:26-32)
  - Error handler creates new EventSource but doesn't update ref
  - Doesn't set up onmessage or onerror handlers on new connection
  - New connection is orphaned and non-functional
  - Should recursively set up full connection or use ref properly

### 2.49 Prompt Editing UI Component (NEW - Jan 2026 Iteration 10)
- [ ] Create prompt editing component for re-runs (refs: dashboard/src/, specs/logging-telemetry.md:232-243)
  - No component for editing prompts and triggering re-runs
  - Even if /rerun endpoint existed, no UI to call it
  - Requires editable textarea and "Run" button

### 2.50 Terminal.tsx Component is Dead Code (NEW - Jan 2026 Iteration 11)
- [ ] Remove unused Terminal.tsx component (refs: dashboard/src/components/Terminal.tsx:1-93)
  - Fully implemented xterm.js terminal component
  - Not imported or used anywhere in dashboard
  - ActivityLog.tsx is used instead for Claude output
  - Related: Remove unused @xterm/xterm and @xterm/addon-fit dependencies from package.json:14-15

### 2.51 Prompt Template Editing UI Missing (NEW - Jan 2026 Iteration 11)
- [ ] Create UI for GET/PUT /prompt endpoints (refs: specs/dashboard.md:201-205, server.ts:266-280)
  - Backend endpoints implemented in server.ts
  - No UI component exists to display or edit prompt template
  - Users cannot interact with prompt endpoints from browser

### 2.52 tool_result Content Block Not Handled (NEW - Jan 2026 Iteration 11)
- [ ] Add tool_result handling to ActivityLog (refs: specs/claude-integration.md:73, ActivityLog.tsx:48-80)
  - ActivityLog only processes thinking, text, and tool_use blocks
  - tool_result events are silently skipped with no display
  - Spec shows tool_result as valid content block type
  - Events lost without user visibility

### 2.53 Iteration Display Missing Feature Name (NEW - Jan 2026 Iteration 11)
- [ ] Show feature name in iteration display (refs: specs/logging-telemetry.md:84, App.tsx:62-63)
  - Spec: "Iteration N (or feature name if available)"
  - Current implementation only shows numeric iteration count
  - No feature name displayed when available

### 2.54 ClaudeMessageEvent.usage Type Mismatch (NEW - Jan 2026 Iteration 11)
- [ ] Fix dashboard type definition for usage field (refs: dashboard/src/types.ts:71-76, specs/claude-integration.md:76-88)
  - Dashboard includes usage field in ClaudeMessageEvent.message
  - Spec says only ClaudeResultEvent contains cost/usage data
  - Type duplication may cause confusion

### 2.55 No Context Window Constant in Dashboard (NEW - Jan 2026 Iteration 11)
- [ ] Define CONTEXT_WINDOW_SIZE constant (refs: specs/logging-telemetry.md:99,362-363)
  - Spec recommends hardcoding 200k for metrics calculations
  - No such constant exists in dashboard/src/
  - Needed for iteration metrics display

### 2.56 SSE Reconnect Lacks Exponential Backoff (NEW - Jan 2026 Iteration 11)
- [ ] Add backoff to SSE reconnection (refs: specs/dashboard.md:277-278, useSSE.ts:26-32)
  - Current: Fixed 1-second reconnect on error
  - No exponential backoff or max retry limit
  - Server down causes reconnect hammering every second
  - Fix: Add exponential backoff with max retries

---

## Priority 3: Missing Functionality

### 3.1 ClaudeService.runWithEvents() Usage
- [ ] Use streaming events in mainLoop (refs: src/program.ts:241-251, src/services/Claude.ts:33-35)
  - Currently uses basic run() method
  - runWithEvents() returns ClaudeEvent stream
  - Enable real-time progress display and logging
  - Forward events to DashboardService for SSE broadcast

### 3.2 LoggingService Implementation
- [ ] Create LoggingService per specs/logging-telemetry.md
  - New service interface and layer
  - `appendEvent(event)` - Append to session JSONL file
  - `getIterationEvents(n)` - Read events for specific iteration
  - `getSessionPath()` - Return path to current session log
  - File format: `.ralph/sessions/{session-id}.jsonl`

### 3.3 JSONL Session Logging
- [ ] Wire LoggingService to Claude event stream (refs: specs/logging-telemetry.md:58-77)
  - Write Claude events to `.ralph/sessions/{session-id}.jsonl`
  - Add iteration boundary markers (`iteration_start` events)
  - Enable session replay and debugging

### 3.4 Iteration Metrics
- [ ] Track and display iteration metrics (refs: specs/logging-telemetry.md:79-111)
  - Extract from ClaudeResultEvent.message.usage
  - Token counts per iteration (input, output, total)
  - Context window percentage
  - Cost tracking (cost_usd)
  - Duration per iteration

### 3.5 New REST Endpoints
- [ ] Add recovery and iteration endpoints (refs: specs/logging-telemetry.md:260-285)
  - `GET /iterations` - Returns iteration list with metrics
  - `GET /logs/:iteration` - Returns raw JSONL for specific iteration
  - `POST /rerun` - Re-run iteration with modified prompt

### 3.6 Session ID Matches Container Name
- [ ] Enforce session-id == container-name for logging (refs: specs/logging-telemetry.md:64)
  - Session log file: `{session-id}.jsonl` where session-id matches container name
  - Ensures log files are discoverable by container name
  - Add assertion/validation in LoggingService

### 3.7 iteration_start Event Schema
- [ ] Implement iteration_start event type (refs: specs/logging-telemetry.md:72-77)
  - Schema: `{"type":"iteration_start","iteration":3,"timestamp":"2025-01-15T14:30:52Z"}`
  - Emit at beginning of each iteration
  - Required for iteration boundary detection in logs

### 3.8 Context Window Percentage Calculation
- [ ] Hardcode 200k context window for metrics (refs: specs/logging-telemetry.md:99, 362-363)
  - Formula: `contextPercent = (totalTokens / 200000) * 100`
  - Hardcode 200k for now (Opus 4 context window)
  - Document for future model changes

### 3.9 Claude CLI Flag Verification
- [ ] Verify all required Claude CLI flags present (refs: specs/claude-integration.md:18-24)
  - Required: `-p`, `--dangerously-skip-permissions`, `--verbose`, `--output-format stream-json`
  - Verify ClaudeLive.ts includes all flags
  - Missing flag would break functionality silently

### 3.10 IterationMetrics Interface
- [ ] Define IterationMetrics interface (refs: specs/logging-telemetry.md:92-99)
  - Fields: iteration, status, inputTokens, outputTokens, totalTokens, contextPercent, duration
  - Status enum: "running" | "passed" | "failed" | "timeout"
  - Add to `/workspace/src/types.ts`
  - Required for P3.4 iteration metrics implementation

### 3.11 tool_result Content Type
- [ ] Add tool_result to ContentBlock union (refs: specs/claude-integration.md:73)
  - Schema: `{ type: "tool_result"; tool_use_id: string; content: string }`
  - Missing from `/workspace/src/types.ts:96-101` ContentBlock union
  - Required for complete Claude event type coverage

### 3.12 Cost Aggregation Tracking
- [ ] Aggregate cost_usd across iterations (refs: specs/claude-integration.md:210-224)
  - Track cumulative session cost from ClaudeResultEvent.cost_usd
  - Display in dashboard and/or log at session end
  - Useful for budget monitoring

### 3.13 NDJSON Buffer Management Pattern
- [ ] Implement proper NDJSON buffer management (refs: ralph.ts:265-303)
  - Accumulate incomplete lines in buffer
  - Use `decoder.decode(value, { stream: true })` option
  - Preserve incomplete last line: `buffer = lines.pop() || ""`
  - Process remaining buffer after stream ends
  - Try-catch around JSON.parse with fallback to raw output

### 3.14 Dual Stream Processing
- [ ] Implement separate stdout/stderr stream handling (refs: ralph.ts:256-324)
  - stdout: Parse as NDJSON with structured ClaudeEvent types
  - stderr: Stream as raw text to console and dashboard
  - `Promise.all([streamNDJSON(stdout), streamStderr(stderr), proc.exited])` pattern

### 3.15 Dashboard vs Non-Dashboard Claude Invocation
- [ ] Conditionally set Claude flags based on dashboard mode (refs: ralph.ts:254-335)
  - Dashboard enabled: `--output-format stream-json`, `--verbose`, pipe streams
  - No dashboard: `stdout: "inherit", stderr: "inherit"` for simpler output
  - Omit streaming flags when not needed

### 3.16 Claude Session JSONL Analysis Documentation (NEW - Jan 2026 Iteration 6)
- [ ] Document that users can examine `.claude/sessions/*.jsonl` for subagent analysis (refs: specs/logging-telemetry.md:228-230)
  - Provide UI link or documentation pointer to session files
  - Files contain detailed subagent execution logs for post-hoc analysis

### 3.17 Iteration Prompt Display in Activity Panel (NEW - Jan 2026 Iteration 6)
- [ ] Show prompt that was sent at iteration start in activity panel header (refs: specs/logging-telemetry.md:170-181)
  - Different from P2.4 (editing) - this is display of what was sent
  - Formatted box at top of activity log showing iteration prompt

### 3.18 IterationMetrics Status Field Implementation (NEW - Jan 2026 Iteration 6)
- [ ] Include status field in IterationMetrics interface (refs: specs/logging-telemetry.md:89-102)
  - Status values: "running", "passed", "failed", "timeout"
  - Display status indicator in iteration card UI
  - Extends P3.10 with specific status tracking

### 3.19 POST /rerun Endpoint Implementation (NEW - Jan 2026 Iteration 7)
- [ ] Implement iteration re-run with modified prompt (refs: specs/logging-telemetry.md:232-254)
  - Edit prompt in textarea
  - POST /rerun endpoint with modified prompt
  - Re-run as iteration N+1 on same branch
  - How iteration N+1 differs from N in state management

### 3.20 Session Recovery on Browser Reconnect (NEW - Jan 2026 Iteration 7)
- [ ] Implement browser-side recovery flow (refs: specs/logging-telemetry.md:260-284)
  - `/iterations` endpoint returns list with metrics
  - `/logs/:iteration` streams JSONL for specific iteration
  - Browser loads iteration sidebar from JSONL on reconnect
  - State machine for reconnection handling

### 3.21 Error Display in Activity Log (NEW - Jan 2026 Iteration 7)
- [ ] Display errors inline in activity log (refs: specs/logging-telemetry.md:286-298)
  - Errors as special events in activity log
  - Iteration card shows ✗ status
  - Define error event type and dashboard rendering

### 3.22 LoggingService Interface Definition (NEW - Jan 2026 Iteration 9)
- [ ] Create LoggingService interface at src/services/Logging.ts (refs: specs/logging-telemetry.md:49-52)
  - Methods: `appendEvent(event)`, `getIterationEvents(n)`, `getSessionPath()`
  - Effect-based interface matching existing service patterns
  - **CRITICAL**: Logging subsystem cannot be implemented without this interface

### 3.23 LoggingLive Layer Implementation (NEW - Jan 2026 Iteration 9)
- [ ] Create LoggingLive layer at src/layers/LoggingLive.ts (refs: specs/logging-telemetry.md:335-344)
  - Implements LoggingService interface
  - Writes to `.ralph/sessions/{session-id}.jsonl`
  - Creates sessions directory if needed
  - **CRITICAL**: Required for JSONL persistence

---

## Priority 4: Robustness Improvements

### 4.1 Git Error Recovery
- [ ] Improve git operation error handling (refs: src/layers/GitLive.ts)
  - Handle merge conflicts gracefully
  - Retry transient failures
  - Better error messages for common issues

### 4.2 Timeout Handling Improvements
- [ ] Add progress-aware timeout (refs: specs/claude-integration.md:132-142)
  - Currently uses fixed 10-minute timeout
  - Extend timeout if Claude is making progress (streaming events)
  - Add configurable timeout via CLI

### 4.3 Error Recovery with Retry Logic
- [ ] Implement retry with exponential backoff for transient failures
  - Docker operations: network errors, daemon restarts
  - Git operations: remote connectivity, lock conflicts
  - Use Effect.retry with Schedule.exponential
  - Cap retries at 3 attempts with jitter

### 4.4 Retry Schedule Configuration
- [ ] Document and configure retry timing (refs: extends P4.3)
  - Initial delay: 100ms
  - Max delay: 5000ms
  - Jitter factor: 0.2
  - Max attempts: 3
  - Exponential base: 2

### 4.5 Docker Daemon Availability Check
- [ ] Verify docker daemon before operations (refs: specs/container.md:34-42)
  - Run `docker version` at startup
  - Fail fast with "ERROR: Docker daemon not running" if fails
  - Prevents confusing errors during container creation

### 4.6 JSONL Parse Error Tolerance
- [ ] Ensure JSON parse errors are non-fatal (refs: discoveries:603-607)
  - Wrap all features.json parsing in try-catch
  - Log error but continue orchestration
  - Consistent pattern across dashboard and orchestrator

### 4.7 Final Verification Reset on Changes
- [ ] Reset finalVerificationDone when changes pushed during verification (refs: ralph.ts:566)
  - If Claude makes changes during final verification iteration
  - Reset `finalVerificationDone = false`
  - Requires another clean verification pass
  - Handles case where Claude fixes issues found during verification

### 4.8 Iteration Boundary Check Order
- [ ] Enforce correct order of loop boundary checks (refs: ralph.ts:434-464)
  - 1. Shutdown/stopping check (exit immediately) - must be first
  - 2. Pause check (poll until resumed) - must be after shutdown
  - 3. Max iterations check (exit if budget exhausted)
  - 4. Container health check (restart or abort)
  - Order matters: shutdown must not block on pause

### 4.9 Push Failure Handling
- [ ] Handle push failures correctly in circuit breaker (refs: ralph.ts:556-567)
  - Push failure: log warning, increment noChangeCount
  - Push success (orchestrator retry): reset noChangeCount AND finalVerificationDone
  - Pattern ensures transient push failures don't halt orchestration

### 4.10 Local Step Mode State
- [ ] Track step mode locally for non-dashboard operation (refs: ralph.ts:426, 573)
  - When dashboard disabled, track stepMode in local variable
  - When dashboard enabled, read from `isStepMode()` function
  - Pattern: `const shouldStep = dashboard ? isStepMode() : stepModeEnabled`

### 4.11 Invalid NDJSON Line Tolerance (NEW - Jan 2026 Iteration 6)
- [ ] Skip unparseable lines and continue stream processing (refs: specs/claude-integration.md:116-120)
  - If Claude outputs invalid JSON line, skip it and continue
  - Don't abort entire stream on single malformed line
  - Log warning but continue parsing subsequent lines

### 4.12 Tool Result Content Normalization (NEW - Jan 2026 Iteration 6)
- [ ] Handle both string and ContentBlock[] variants of tool_result.content
  - Some Claude API responses return `content: string`
  - Others may return `content: ContentBlock[]`
  - Normalize to consistent format for downstream handling

### 4.13 Git Authentication Priority Documentation (NEW - Jan 2026 Iteration 6)
- [ ] Document that HTTPS (with token) is preferred, SSH is fallback (refs: specs/networking.md)
  - When both are available, credential helper (HTTPS) takes precedence
  - SSH is fallback when GITHUB_TOKEN unavailable
  - Document this decision in code comments and user docs

### 4.14 NDJSON Error Message Truncation Indicator (NEW - Jan 2026 Iteration 7)
- [ ] Add truncation indicator to NDJSON error messages (refs: src/streams/ndjson.ts:28)
  - Current: `line.slice(0, 100)` without indicator if truncated
  - Should include `${line.length > 100 ? '...' : ''}` suffix
  - Prevents confusion about whether full line is shown

### 4.15 Container Partial Initialization Failure Recovery (NEW - Jan 2026 Iteration 7)
- [ ] Handle partial initialization failures gracefully (refs: specs/container.md:75-85)
  - What if firewall init succeeds but git clone fails?
  - Which state should container be in for cleanup to work?
  - Log which stage failed for debugging

### 4.16 Network Timeout Recovery (NEW - Jan 2026 Iteration 7)
- [ ] Add recovery logic for network timeouts during startup (refs: specs/networking.md:44-99)
  - What if GitHub IP range API is down?
  - What if DNS resolution fails?
  - Retry logic, fallback IP ranges, graceful degradation

### 4.17 Features.json Concurrent Modification (NEW - Jan 2026 Iteration 7)
- [ ] Handle concurrent features.json modification (refs: specs/orchestrator.md:30-31)
  - What if Claude and orchestrator write simultaneously?
  - File locking mechanism or conflict detection
  - Validation that format hasn't changed mid-iteration

### 4.18 Circular Dependency Detection in Services (NEW - Jan 2026 Iteration 7)
- [ ] Validate service dependency graph is acyclic (refs: src/layers/*.ts)
  - ClaudeLive and GitLive both depend on DockerService
  - No explicit validation prevents circular dependencies
  - Effect should detect at runtime, but validation at build time better

### 4.19 Container Start Operation Timeout (NEW - Jan 2026 Iteration 9)
- [ ] Add timeout to docker start operation (refs: program.ts:60-68)
  - `docker start` can hang indefinitely if entrypoint.sh blocks
  - No timeout applied (contrast with Claude's 10min timeout)
  - Should use Effect.timeout or similar pattern
  - Prevents orchestrator from hanging on container startup failures

### 4.20 Session ID Collision Risk in Concurrent Scenarios (NEW - Jan 2026 Iteration 9)
- [ ] Add uniqueness to session ID generation (refs: container.ts:20)
  - Current: `ralph-${Date.now()}` uses millisecond timestamp
  - If two instances start in same millisecond, identical container names
  - Docker create fails with "container name already in use"
  - Pattern: Add random suffix or process ID for uniqueness

---

## Priority 5: Test Coverage Gaps

### 5.1 Service Layer Tests
- [ ] Add unit tests for DockerLive methods (refs: src/layers/DockerLive.ts)
  - Test create(), start(), remove(), inspect() with real Docker or testcontainers
  - Test exec() and execStream() output parsing
  - Test readFile() and writeFile() round-trip
  - Test copyToContainer() once implemented

### 5.2 Session Creation Tests
- [ ] Add tests for createSession() function (refs: src/program.ts:23-200)
  - Test container creation and startup sequence
  - Test git clone and repository setup
  - Test branch checkout logic (resume vs new)
  - Test firewall ready detection (once implemented)

### 5.3 Dashboard Server Tests
- [ ] Add tests for dashboard HTTP endpoints (refs: src/server.ts)
  - Test SSE client connection/disconnection
  - Test POST /pause, /resume, /step-mode, /stop
  - Test GET/PUT /prompt template operations
  - Test state broadcasting to multiple clients

### 5.4 Integration Test Suite
- [ ] Add end-to-end orchestration tests
  - Full session lifecycle: create → iterate → cleanup
  - Circuit breaker triggering after 3 no-change iterations
  - Feature completion detection
  - Signal handling (if practical to test)

### 5.5 Stream Utility Tests
- [ ] Add tests for remaining ndjson.ts utilities (refs: src/streams/ndjson.ts:41-101)
  - `parseNDJSONWithFallback()` - discriminated union return, mixed JSON/text handling
  - `fromReadableStream()` - WHATWG ReadableStream conversion
  - `collectAll()` - stream-to-array collection
  - `forEach()` - side-effect iteration
  - Currently only `parseNDJSON()` has comprehensive tests

### 5.6 ZFC Compliance Tests
- [ ] Add tests enforcing ZFC patterns (refs: specs/zfc-architecture.md:261-280)
  - Test that verify_command uses only exit codes
  - Test no keyword matching on Claude output
  - Test all decisions use structured data
  - Architectural enforcement through tests

### 5.7 Firewall Ready Detection Tests
- [ ] Add tests for firewall detection (refs: P1.2, P1.27)
  - Mock log streaming
  - Verify detection of "Ralph Firewall Ready" message
  - Test timeout after 30 seconds
  - Test polling interval behavior

### 5.8 Signal Handling Tests
- [ ] Add tests for graceful shutdown (refs: P1.5)
  - Test cleanup runs even on error
  - Test container removal on shutdown
  - Test double-signal force exit
  - May require mock signal handlers

### 5.9 createSession() Function Tests
- [ ] Add tests for createSession() (refs: src/program.ts:23-200)
  - 177 lines of critical path code
  - Test container creation sequence
  - Test git clone and branch setup
  - Test firewall ready waiting
  - Currently 0% coverage

### 5.10 Command Injection Tests
- [ ] Add security tests for prompt escaping (refs: P1.49)
  - Test prompts with double quotes, backticks, dollar signs
  - Verify no shell injection possible
  - Test boundary cases: empty prompt, very long prompt
  - Part of security test suite

### 5.11 Error Recovery Path Tests
- [ ] Test iteration error recovery behavior (refs: P1.53)
  - Simulate timeout during runIteration
  - Verify noChangeCount increments (not fatal error)
  - Verify bell character emitted
  - Verify loop continues to next iteration

### 5.12 Volume Mount Validation Tests
- [ ] Test container creation with various env states (refs: P1.50, P1.55)
  - Test with HOME undefined
  - Test with missing .ssh directory
  - Test with missing .claude directory
  - Verify correct error messages

### 5.13 GitHub IP Aggregation Tests (NEW - Jan 2026 Iteration 6)
- [ ] Test aggregate tool with GitHub IP ranges (refs: specs/networking.md:102-114)
  - Test empty input, single CIDR, overlapping ranges
  - Verify aggregation produces valid ipset entries
  - Part of firewall verification tests

### 5.14 SSH Non-Interactive Mode Tests (NEW - Jan 2026 Iteration 6)
- [ ] Verify SSH operations don't require user input (refs: specs/container.md:213)
  - Test that SSH doesn't prompt for host key acceptance
  - Verify UserKnownHostsFile=/dev/null works correctly
  - Required for non-interactive git operations
  - Test with HOME undefined
  - Test with missing .ssh directory
  - Test with missing .claude directory
  - Verify correct error messages

### 5.15 SSE Client Race Condition Tests (NEW - Jan 2026 Iteration 7)
- [ ] Test concurrent SSE client registration (refs: P1.91)
  - Simulate multiple clients connecting simultaneously
  - Verify all clients receive broadcasts
  - Test for Set corruption during concurrent access

### 5.16 Stream Cancellation Resource Leak Tests (NEW - Jan 2026 Iteration 7)
- [ ] Test resource cleanup on stream interruption (refs: P1.89)
  - Verify docker exec process terminates when stream cancelled
  - Check for zombie processes after interrupted operations
  - Test Effect.scoped cleanup behavior

### 5.17 Feature Element Validation Tests (NEW - Jan 2026 Iteration 7)
- [ ] Test malformed feature array elements (refs: P1.92)
  - Test `features: [null]` - should error gracefully
  - Test `features: [{}]` - missing passes property
  - Test `features: [{"other": true}]` - wrong property

### 5.18 Iteration State Invariant Tests (NEW - Jan 2026 Iteration 7)
- [ ] Test iteration state machine correctness (refs: P1.96)
  - Verify iteration always increments by exactly 1
  - Verify noChangeCount never goes negative
  - Test boundary conditions near maxIterations

### 5.19 stderr Stream Consumption Tests (NEW - Jan 2026 Iteration 8)
- [ ] Test stderr stream is consumed in ClaudeLive (refs: P1.110)
  - Verify stderr stream doesn't cause process blocking
  - Test with large stderr output
  - Verify no resource leaks when stream cancelled

### 5.20 Host Network Detection Tests (NEW - Jan 2026 Iteration 8)
- [ ] Test host IP detection in firewall (refs: docker/init-firewall.sh:110-118)
  - Test host IP extraction from default route
  - Test /24 network computation
  - Critical networking code has no tests

### 5.21 parseStaleContainers Format Validation Tests (NEW - Jan 2026 Iteration 9)
- [ ] Test container name parsing robustness (refs: container.ts:27-28)
  - Test with different docker ps output formats
  - Test with wrapped lines, extra columns, error messages
  - Current parser assumes one container name per line
  - Fragile parsing could cause cleanup to fail silently

### 5.22 Branch Parameter Optional vs Required Tests (NEW - Jan 2026 Iteration 9)
- [ ] Test behavior when branch parameter undefined (refs: Config.ts:12, program.ts usage)
  - Config interface: `branch: string | undefined` (optional)
  - program.ts:82,173,186 use branch unconditionally
  - Should test error behavior or default generation
  - Type vs runtime inconsistency needs coverage

### 5.23 Path Traversal Prevention Tests (NEW - Jan 2026 Iteration 10)
- [ ] Test file path validation in DockerLive (refs: P1.127)
  - Test paths with `../` sequences
  - Test paths outside /workspace boundary
  - Verify rejection of malicious paths
  - Security test suite expansion

### 5.24 Container Name Validation Tests (NEW - Jan 2026 Iteration 10)
- [ ] Test containerName parameter validation (refs: P1.128)
  - Test names with shell metacharacters
  - Test command substitution attempts
  - Verify regex validation of expected pattern
  - Security test suite expansion

### 5.25 SSE Client Memory Leak Tests (NEW - Jan 2026 Iteration 10)
- [ ] Test SSE client cleanup on disconnect (refs: P1.133)
  - Verify failed clients removed from Set immediately
  - Test memory doesn't grow with disconnected clients
  - Simulate disconnect and verify cleanup

### 5.26 Detached HEAD Git State Tests (NEW - Jan 2026 Iteration 10)
- [ ] Test GitLive behavior in detached HEAD state (refs: P1.136)
  - Simulate detached HEAD condition
  - Verify graceful handling (return false, not error)
  - Test edge cases during container setup

### 5.27 ClaudeLive Prompt Shell Escaping Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test prompt escaping in ClaudeLive.ts:41 (SECURITY)
  - **P0 SECURITY**: Double quotes in prompt not escaped before shell execution
  - Test prompts containing: `"`, `` ` ``, `$()`, `${}`
  - Verify shell metacharacters don't break out of quote context
  - Part of security test suite

### 5.28 DockerLive.listByPrefix Shell Injection Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test prefix parameter escaping (refs: DockerLive.ts:296) (SECURITY)
  - **P0 SECURITY**: Single quotes in prefix can break out of find command
  - Test prefixes: `foo'; rm -rf /; echo '`, `foo\`whoami\``, `foo$(cat /etc/passwd)`
  - Verify command construction is safe

### 5.29 DockerLive.exec User Parameter Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test user parameter validation (refs: DockerLive.ts:206-219)
  - No validation that user string is safe
  - Test users: `node; whoami`, `node\`echo hi\``, `node$(id)`
  - Should reject or escape invalid values

### 5.30 parseNDJSONWithFallback Tests (NEW - Jan 2026 Iteration 11)
- [ ] Add tests for parseNDJSONWithFallback (refs: ndjson.ts:41-60)
  - **0% coverage** despite being exported utility
  - Test mixed valid/invalid JSON handling
  - Verify discriminated union types { json: T } | { text: string }

### 5.31 fromReadableStream Tests (NEW - Jan 2026 Iteration 11)
- [ ] Add tests for WHATWG stream conversion (refs: ndjson.ts:68-79)
  - **0% coverage** on exported utility
  - Test error mapping to StreamError
  - Test stream consumption completes properly

### 5.32 collectAll Tests (NEW - Jan 2026 Iteration 11)
- [ ] Add tests for stream collection utility (refs: ndjson.ts:86-89)
  - **0% coverage** on exported utility
  - Test memory behavior with large streams
  - Test error propagation

### 5.33 forEach Tests (NEW - Jan 2026 Iteration 11)
- [ ] Add tests for side-effecting stream consumption (refs: ndjson.ts:97-101)
  - **0% coverage** on exported utility
  - Test callback invocation for each element
  - Test error propagation from callback

### 5.34 ConfigLive Git Root Error Path Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test git command failure handling (refs: ConfigLive.ts:14-25)
  - Test ConfigError when not in git repo
  - Test permission denied scenarios
  - Verify error messages are helpful

### 5.35 Server.ts Set Mutation During Iteration Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test broadcast during client disconnect (refs: server.ts:34-39)
  - **Correctness bug**: Set.delete during iteration is undefined behavior
  - Test 5 clients, client 3 throws on enqueue
  - Verify clients 4 and 5 still receive event

### 5.36 DockerLive.writeFile Large Content Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test large content writes (refs: DockerLive.ts:265-288)
  - Test 100KB+ content through stdin stream
  - Verify stream closes properly
  - Test backpressure handling

### 5.37 main.ts Entry Point Error Handling Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test error formatting in main.ts (refs: main.ts:62-68)
  - Test different error types (ConfigError, DockerError, etc.)
  - Verify error messages formatted correctly
  - Verify exit codes

### 5.38 Server.ts CORS Preflight Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test OPTIONS request handling (refs: server.ts:284-292)
  - Verify correct CORS headers returned
  - Test all endpoints support OPTIONS
  - Required for cross-origin dashboard scenarios

### 5.39 ClaudeLive.runWithEvents Mid-Stream Timeout Tests (NEW - Jan 2026 Iteration 11)
- [ ] Test timeout during active streaming (refs: ClaudeLive.ts:118)
  - Mock stream emitting 3 events then hanging
  - Verify TimeoutError thrown (not ClaudeError)
  - Verify partial results discarded

---

## Priority 6: Dashboard & Streaming Integration Gaps

### 6.1 Claude Event Streaming to Dashboard
- [ ] Wire ClaudeService.runWithEvents() output to DashboardService.broadcast() (refs: ralph.ts:284-301)
  - program.ts:303-306 calls runIteration() but doesn't capture event stream
  - Each ClaudeEvent from stream should be broadcast to SSE clients
  - Required for real-time progress display in dashboard

### 6.2 Output vs Claude Event Distinction
- [ ] Handle dual event types in dashboard streaming (refs: ralph.ts:282-302)
  - Stdout: Attempt JSON parse as ClaudeEvent, fallback to raw text via sendOutput()
  - Stderr: Always send as raw text via sendOutput()
  - Current DashboardService has generic broadcast() with no distinction

### 6.3 NDJSON Parse Error Handling in Stream
- [ ] Ensure JSON parse errors are non-fatal in stream processing (refs: ralph.ts:283-289)
  - Wrap JSON.parse in try-catch for each line
  - On parse failure, emit fallback event (raw text)
  - Stream should not fail on invalid NDJSON

### 6.4 Dashboard State Cleanup on Session End
- [ ] Update dashboard state on session termination (refs: ralph.ts:630-631)
  - Call `updateState({ running: false })` in finally block
  - Ensure server shutdown and state cleanup on session end
  - Wire DashboardService.stop() to main.ts cleanup

### 6.5 Separate Stderr Streaming
- [ ] Handle stderr stream separately from stdout (refs: ralph.ts:306-316)
  - streamStderr pipes stderr directly to sendOutput()
  - Current ClaudeService.runWithEvents() returns combined stream
  - Need to handle stderr in addition to stdout event stream

### 6.6 Stream Buffer Management Verification
- [ ] Verify buffer management for incomplete lines (refs: ralph.ts:268-302)
  - Streams operate on chunks, not line boundaries
  - Verify parseNDJSON handles partial JSON across chunks
  - Split on `\n`, keep incomplete line in buffer for next chunk

### 6.7 Docker Exec User Flag Consistency
- [ ] Document and enforce user flag patterns (refs: ralph.ts:208, 211, 215)
  - Git operations: Always use `-u node` flag
  - Chown/file operations: Use root (no -u flag)
  - Feature file read: `-u node`
  - DockerLive.exec() has optional user param but callers must remember

### 6.8 Docker Logs Polling Implementation
- [ ] Implement actual polling loop for firewall detection (refs: ralph.ts:186-188)
  - Current program.ts:74-75 just does `Effect.sleep("3 seconds")` hardcoded
  - Need polling loop with `docker logs` check every 1 second
  - Max 30 iterations before timeout
  - Extends P1.2 with concrete implementation details

### 6.9 Docker PS Filtering Fix (CRITICAL)
- [ ] Fix DockerService.listByPrefix() to search Docker daemon (refs: ralph.ts:137)
  - Current DockerLive:292-318 searches `/workspace` filesystem
  - Should use `docker ps -a --filter name=ralph-session --format "{{.Names}}"`
  - Fundamental mismatch for stale container cleanup (P1.9)

### 6.10 Remote Branch Verification Integration
- [ ] Wire branch verification to main.ts startup (refs: ralph.ts:388-396)
  - P1.31 describes pattern, but no integration point in main.ts
  - Should fail immediately if user specifies invalid resume branch
  - Run before expensive container creation

### 6.11 Clone Branch Selection in Program
- [ ] Implement branch selection logic in clone command (refs: ralph.ts:202)
  - Pattern: `const cloneBranch = isResume ? branch : "trunk"`
  - Current program.ts:82 hardcodes gitRoot as clone URL
  - Need to clone from remote URL with correct branch

### 6.12 Git Push -u Flag Verification
- [ ] Verify setUpstream option translates to -u flag (refs: ralph.ts:558)
  - GitLive.ts:58-75 has push() with setUpstream option
  - program.ts:258 uses `.push({ setUpstream: true })`
  - Need to verify this produces correct `git push -u origin HEAD` command

### 6.13 Unpushed Detection for New Branches
- [ ] Handle case where remote branch doesn't exist (refs: ralph.ts:542-553)
  - If remote exists: `git log origin/${branch}..HEAD`
  - If remote doesn't exist: Any local commits = unpushed
  - Extends P1.61 with specific implementation guidance

### 6.14 Features.json Error Tolerance in Dashboard
- [ ] Continue orchestration on JSON parse error (refs: ralph.ts:474-480)
  - Wrap JSON parse in try-catch, continue on error
  - Dashboard should gracefully degrade if JSON invalid
  - Log error but don't halt automation

### 6.15 Features.json Write Integration
- [ ] Wire features.json copying to createSession (refs: ralph.ts:217-227)
  - Read from local filesystem
  - Create .ralph directory in container
  - Write via heredoc or DockerService.writeFile()
  - Currently not integrated in createSession()

### 6.16 Plan Mode Completion Detection Integration
- [ ] Add plan mode exit logic to mainLoop (refs: ralph.ts:614-626)
  - Check: PR exists AND no unpushed commits
  - If both true, Claude signals completion → exit gracefully
  - Different from build mode completion

### 6.17 Plan Mode Iteration Display
- [ ] Show plan-specific status in dashboard (refs: ralph.ts:500-503)
  - "Running planning analysis..." instead of feature count
  - Reports maxIterations: 1 to dashboard
  - Reports remaining: 0 (no features in plan mode)

### 6.18 Second Signal Force Exit
- [ ] Implement double-signal force exit (refs: ralph.ts:85-91)
  - First SIGINT → graceful shutdown (set stopping flag)
  - Second SIGINT → force exit immediately (process.exit)
  - Track `shutdownRequested` flag for detection

### 6.19 Bell Character on Circuit Breaker
- [ ] Emit terminal bell when circuit breaker triggers (refs: ralph.ts:534)
  - Output `\x07` character to alert user
  - Useful for attention when running in background
  - Minor UX improvement

### 6.20 1-Hour Safety Timeout Clarification
- [ ] Update timeout strategy per ralph.ts (refs: ralph.ts:46)
  - ralph.ts uses 1 hour: "safety fallback (Claude Code handles its own timeouts)"
  - Current program.ts:244 uses 10 minutes
  - Should use 1 hour for outer timeout, Claude handles inner timeouts

### 6.21 Polling Interval for Firewall
- [ ] Define polling interval in firewall detection (refs: ralph.ts:185-188)
  - Poll every 1 second (Bun.sleep(1000))
  - Max 30 iterations
  - Concrete implementation for P1.27

### 6.22 Entrypoint vs Keep-Alive Separation
- [ ] Document entrypoint lifecycle (refs: ralph.ts:179)
  - Entrypoint.sh runs once, then keep-alive takes over
  - Entrypoint must complete, not run indefinitely
  - Affects firewall ready detection timing

### 6.23 mainLoop Parameter Threading Enhancement
- [ ] Expand mainLoop signature for full control (refs: extends P1.40)
  - Current: `{ containerName, prompt }`
  - Needs: args (once, maxIterations), mode (plan vs build), initialState
  - More comprehensive than P1.40 scope

### 6.24 Volume Mount .gitconfig Missing
- [ ] Add .gitconfig volume mount (refs: ralph.ts:167-169)
  - Missing from program.ts:36-40
  - Add: `${process.env.HOME}/.gitconfig:/home/node/.gitconfig:ro`
  - Required for git config to work without --system

### 6.25 Home vs Node User Path Mapping
- [ ] Document volume mount path mapping (refs: ralph.ts volume mounts)
  - Host ~/.ssh → container /root/.ssh (for root ops)
  - Host ~/.claude → container /home/node/.claude (for node user)
  - Need to handle both root and node user contexts

### 6.26 Prompt Template File Read
- [ ] Implement template file reading (refs: ralph.ts:407-409)
  - Read template from RALPH_HOME/templates/ directory
  - Select based on mode (plan vs build)
  - Current main.ts:34-35 has placeholder paths only

### 6.27 Three Iteration Limits Coordination
- [ ] Coordinate three separate iteration controls (refs: ralph.ts)
  - `maxIterations` from CLI args
  - `MAX_NO_CHANGE = 3` circuit breaker constant
  - `finalVerificationDone` extra iteration flag
  - All three must be checked in correct order

### 6.28 Push Failure Increments noChangeCount Pattern (NEW - Jan 2026 Iteration 9)
- [ ] Implement push failure handling in Effect mainLoop (refs: ralph.ts:558-562)
  - When push fails (exitCode !== 0), increment noChangeCount
  - Prevents infinite retry loops on transient git push failures
  - Pattern from ralph.ts not yet implemented in Effect code
  - Relates to P4.9 but this is Effect-specific implementation

### 6.29 Push Success Resets finalVerificationDone Pattern (NEW - Jan 2026 Iteration 9)
- [ ] Reset finalVerificationDone on successful push (refs: ralph.ts:563-567)
  - When push succeeds during final verification, reset flag
  - If Claude makes changes during verification, need another clean pass
  - Pattern from ralph.ts - Effect version doesn't have finalVerificationDone yet
  - Relates to P4.7 but this is Effect-specific implementation

### 6.30 Firewall For-Loop Polling Pattern (NEW - Jan 2026 Iteration 9)
- [ ] Use for-loop pattern for firewall detection (refs: ralph.ts:185-189)
  - Pattern: `for (let i = 0; i < 30; i++)` with 1-second sleep
  - Explicit iteration limit AND early exit on detection
  - Different from Effect.retry - shows exact 30-second max wait
  - Current Effect code uses fixed 3-second sleep

### 6.31 Iteration Boundary Check Sequence (NEW - Jan 2026 Iteration 9)
- [ ] Implement all four boundary checks in correct order (refs: ralph.ts:436-464)
  - 1. Shutdown/stopping check (line 436-438)
  - 2. Pause check with polling (line 442-449)
  - 3. maxIterations check (line 453-456)
  - 4. Container health check (line 460-464)
  - All checks happen BEFORE running Claude to prevent wasted API calls

### 6.32 Dashboard Server Timing Pattern (NEW - Jan 2026 Iteration 9)
- [ ] Start dashboard server at correct point in sequence (refs: ralph.ts:412-423)
  - Start AFTER createSession but BEFORE entering main loop
  - Dashboard needs containerName in initial state
  - Effect version has no dashboard integration in main.ts yet
  - Extends P1.107 with implementation timing details

### 6.33 Features Parse Silent Catch Pattern (NEW - Jan 2026 Iteration 9)
- [ ] Use try-catch with silent ignore for features.json (refs: ralph.ts:474-480)
  - Dashboard update is non-critical
  - If features.json malformed during iteration, continue orchestration
  - Pattern: `try { ... } catch { /* Ignore parse errors */ }`
  - Relates to P6.14 but specifies exact try-catch-ignore pattern

---

## Discoveries

### Iteration 11 Key Discoveries (Jan 2026)

**Security Vulnerabilities Require Immediate Attention**:
- 2 HIGH severity: P1.143 (volume mount injection), P1.144 (ralph.ts Docker create)
- 4 MEDIUM severity: P1.145-P1.148 (firewall race, API injection, path traversal, sessionId)
- Combined with existing 5 CRITICAL (P1.49, P1.81, P1.82, P1.118, P1.119) = 11 security issues total

**Test Coverage Analysis (P0-P3)**:
- 2 P0 (CRITICAL security): ClaudeLive prompt escaping, DockerLive.listByPrefix injection
- 4 stream utilities with 0% coverage: parseNDJSONWithFallback, fromReadableStream, collectAll, forEach
- Server.ts Set mutation during iteration is undefined JavaScript behavior

**Orchestrator Integration Gaps**:
- Dashboard broadcast completely missing from program.ts mainLoop
- Error recovery strategy per spec not implemented (DockerError retry, TimeoutError continue)
- Step mode checkpoint logic not in mainLoop despite being parsed from CLI

**Dashboard Dead Code**:
- Terminal.tsx with xterm.js fully implemented but never used
- @xterm/xterm and @xterm/addon-fit dependencies can be removed
- ActivityLog.tsx is the actual implementation, Terminal.tsx is orphaned

### Existing Utilities (src/lib equivalent)
- `/workspace/src/streams/ndjson.ts` - Comprehensive NDJSON parsing with error handling
- `/workspace/src/errors/index.ts` - Full suite of tagged error types
- `/workspace/src/container.ts` - Container name generation, feature parsing, git status parsing
- All utilities have comprehensive test coverage (110 tests total)

### Effect Patterns Already Established
- Context.Tag for dependency injection (all services)
- Layer composition with MainLive
- Tagged errors with Effect.catchTag
- Stream processing with Effect Stream
- Ref for mutable state management (DashboardLive)

### Test Infrastructure Ready
- TestLive layer with all mock services
- Integration tests for mainLoop and runIteration
- Unit tests for all utilities

### Type Workarounds
- `as any` used for Effect Context.Tag interface/class shadowing issue
- Documented in multiple layer files (ClaudeLive:135, GitLive:138, DashboardLive:188)
- 3 production instances, 28 test instances - consistent pattern

### Dual Dashboard Implementations
- Legacy: `/workspace/src/server.ts` - global mutable state, direct Bun.serve
- Effect-based: `/workspace/src/layers/DashboardLive.ts` - Effect.Ref, scoped lifecycle
- Need to consolidate to single implementation

### Dual Orchestration Implementations (Critical)
- Legacy: `/workspace/ralph.ts` - Active, used in production, ~650 lines
  - Has working: signal handling, firewall detection, step mode, event streaming, CLI prompts
  - Has working: branch generation, features.json copying, resume logic, plan mode completion
  - Uses: Bun.spawn, Bun.$, direct process management
- Effect-based: `/workspace/src/main.ts` + `/workspace/src/program.ts` - In development
  - Has working: service interfaces, layer composition, test infrastructure
  - Missing: wiring to createSession, cleanup, signal handling, step mode
  - Missing: branch generation, features copying, resume logic, plan completion detection
- The Effect implementation needs to replicate all working features from ralph.ts
- **Migration Strategy**: ralph.ts serves as working reference for all P1 features

### Branch Naming Logic Exists
- `generateContainerName()` in `/workspace/src/container.ts` generates timestamps
- Pattern available but not wired to main.ts branch creation
- Container naming uses `ralph-session-{timestamp}` pattern

### CLI Args Parsed but Not Used
- `--once` flag parsed at src/args.ts:33-34 but not checked in mainLoop (see P1.7)
- `stepMode` parsed at src/args.ts:40 but not integrated with iteration pause logic (see P2.3)
- `maxIterations` parsed at src/args.ts:35-37 but loop condition at program.ts:295-297 doesn't check it (see P1.8)

### Model Always Hardcoded to Opus
- ClaudeLive.ts lines 27 and 76 always use `claude-opus-4-5-20251101`
- No CLI flag to override model selection
- Consistent with specs but worth noting for future flexibility

### Environment Validation Differences (ConfigLive vs ralph.ts)
- **ConfigLive.ts** validates only `CLAUDE_CODE_OAUTH_TOKEN` (required)
- **ralph.ts** accepts either `CLAUDE_CODE_OAUTH_TOKEN` OR `ANTHROPIC_API_KEY`
- **Spec** (orchestrator.md:199-202) documents only OAuth token as required
- **ConfigLive.ts** falls back to empty string for missing GITHUB_TOKEN
- **ralph.ts** auto-detects GITHUB_TOKEN via `gh auth token` command
- Both approaches need reconciliation

### Missing Test Coverage Areas
- 0% coverage on service layer implementations (~931 lines total):
  - DockerLive.ts: 324 lines
  - ClaudeLive.ts: 137 lines
  - GitLive.ts: 140 lines
  - ConfigLive.ts: 67 lines
  - DashboardLive.ts: 216 lines
  - layers/index.ts: 47 lines
- 0% coverage on createSession() function (177 lines, critical path)
- 0% coverage on dashboard server endpoints (server.ts, 300 lines)
- 0% coverage on main.ts entry point (69 lines)
- No integration tests for full orchestration lifecycle
- ~59% coverage on ndjson.ts (parseNDJSON tested, 4 other utilities untested)
- Test-to-code ratio: ~54% (1,260 test lines / 2,351 source lines)
- Currently tested: args, container, errors, program logic (with mocks), parseNDJSON

### Hardcoded Values Requiring Attention
- Claude model: `"claude-opus-4-5-20251101"` hardcoded in ClaudeLive.ts (lines 27, 76)
- Config timeout: `5 * 60 * 1000` ms hardcoded in ConfigLive.ts (line 60)
- Claude operation timeout: `10 * 60 * 1000` ms hardcoded in program.ts (line 244)
- Firewall wait: `"3 seconds"` hardcoded in program.ts (line 75)
- Circuit breaker threshold: `3` iterations hardcoded in program.ts (lines 297, 324, 328)
- Docker image: `"ralph-base:latest"` hardcoded in program.ts (line 34)
- All paths assume `process.env.HOME` exists and has `.ssh` and `.claude` directories

### Implementation Patterns from ralph.ts (Reference for Effect Migration)
- **Heredoc for File Writing** (ralph.ts:221-223, 507-509): Uses bash heredoc for multi-line file writing
- **AbortSignal.any()** (ralph.ts:250-251): Combines multiple abort signals for timeout + user cancellation
- **NDJSON Event Streaming** (ralph.ts:256-303): Buffer management for streaming JSON events
- **Promise.race for Input** (ralph.ts:591): Dual input source handling (CLI + dashboard)
- **Bell Character Alert** (ralph.ts:534): Terminal bell (`\x07`) on circuit breaker
- **Quiet/Nothrow Flags** (ralph.ts:140, 235, 487, 558): Error suppression for expected failures

### Spec-Documented Requirements Not Yet in Code
- **SSH Key Setup Verification**: Entrypoint copies keys from `/root/.ssh` to `/tmp/.ssh/`, sets permissions 700/600
- **Git Safe Directory**: Must configure `safe.directory /workspace` in container
- **Capability Restriction**: Container should only have `CAP_NET_ADMIN` capability
- **Clone Must Be From Remote**: Spec explicitly requires clone from `remote_url` not local filesystem copy
- **"Mark PR Ready" Action**: Spec says "mark PR ready and exit" - implemented via `gh pr ready` command

### Timeout Scope Clarification
Per research, different operations have different timeouts:
- **Claude execution**: 10 minutes (default, configurable)
- **Container startup/firewall wait**: 30 seconds fallback
- **Docker operations**: Not specified (should use transient failure retry)
- **Git operations**: Not specified (should use transient failure retry)

### Additional Gap Analysis Findings (Jan 2026)

**Bun-Specific API Patterns**:
- `.quiet().nothrow()` - Suppresses output and allows non-zero exit codes (ralph.ts:140, 235, 487)
- Used for: container cleanup, PR ready, commands that may fail expectedly
- Effect equivalent: `Effect.orElse(() => Effect.succeed(null))` with logging disabled

**Container Command Requirement**:
- Container must be created with `sleep infinity` command
- This keeps container running after entrypoint.sh completes
- Entrypoint.sh initializes firewall then returns
- Without `sleep infinity`, container would exit immediately

**Read-Only Mount Implications**:
- `.gitconfig` mounted with `:ro` flag (ralph.ts:169)
- Prevents container from modifying host git configuration
- Requires all git config changes to use `--system` instead of `--global`
- This is a security-conscious design decision

**Features.json Error Tolerance**:
- Dashboard parsing errors are non-fatal (ralph.ts:474-480)
- Wrapped in try-catch with empty catch
- Orchestration continues even if dashboard can't display features
- Prevents JSON parse errors from halting automation

**PR Existence Check Pattern**:
- Uses `gh pr view HEAD --json url` (ralph.ts:616-624)
- Checks for `'"url"'` substring in output (string match, not JSON parse)
- Simple pattern avoids JSON parsing complexity for boolean check

### Test Coverage Summary (from gap analysis)
- **Tested Source Files**: 5 (args.ts, container.ts, program.ts partial, ndjson.ts partial, errors/index.ts)
- **Untested Source Files**: 14 (main.ts, server.ts, all layers, all services interfaces)
- **Total test lines**: 1,264 across 5 test files
- **Skipped Tests**: 0
- **TODOs in Source**: 1 (`program.ts:74`)

### Service Layer Coverage
- 0% coverage on live layer implementations (~931 lines total):
  - DockerLive.ts: 325 lines - NOT tested
  - ClaudeLive.ts: 138 lines - NOT tested
  - GitLive.ts: 141 lines - NOT tested
  - ConfigLive.ts: 68 lines - NOT tested
  - DashboardLive.ts: 217 lines - NOT tested
- createSession(): 177 lines - NOT tested (critical path)
- server.ts: 301 lines - NOT tested (dashboard endpoints)

### Implementation Completeness Estimate
Based on comprehensive gap analysis comparing ralph.ts (641 lines, working) vs Effect implementation:
- **Effect implementation is ~40-50% complete**
- Service architecture scaffolded: YES
- Core orchestration logic: PARTIAL (mainLoop, runIteration work)
- Lifecycle management: MISSING (signals, cleanup, health checks)
- Dashboard integration: MISSING (state sync, event streaming)
- Step mode: MISSING
- Final verification: MISSING
- Plan mode completion: MISSING

### Largest Gap: Logging/Telemetry Subsystem (P3)
The logging subsystem (P3.1-P3.9) represents the largest unimplemented feature area:
- **LoggingService interface**: Not created (specs/logging-telemetry.md:49-52)
- **LoggingLive layer**: Not created (specs/logging-telemetry.md:335-344)
- **iteration_start event type**: Not in types.ts (specs/logging-telemetry.md:72-76)
- **IterationMetrics interface**: Not defined (specs/logging-telemetry.md:93-101)
- **New REST endpoints**: GET /iterations, GET /logs/:iteration, POST /rerun not implemented
- **UI components**: IterationSidebar, ToolCall rendering, SubagentTracker not implemented
- This subsystem is ~10% of total implementation but 0% started

### Spec Clarification: Features.json Schema
Per specs/features.md:6-19, the features.json schema has exactly 4 fields:
- `id` (required)
- `description` (required)
- `passes` (required)
- `verify_command` (optional)
There is NO `dependencies` field in the spec. P1.47 was updated to reflect this.

### Security Vulnerabilities Identified (Jan 2026 Analysis)
- **P1.49 Command Injection**: ClaudeLive prompt strings not escaped before shell execution
  - Severity: CRITICAL
  - Affects: src/layers/ClaudeLive.ts:41, 89
  - Attack vector: Prompt containing `"`, `$`, backticks breaks out of quotes
- **DockerLive.exec Shell Injection**: Command string passed directly to `sh -c`
  - Severity: MEDIUM (internal use only)
  - Affects: src/layers/DockerLive.ts:206-219
  - Mitigated by: Commands come from trusted internal sources

### Implementation Completeness Update (Jan 2026 - Iteration 4)
Based on comprehensive parallel gap analysis using 3 research agents:
- **Effect implementation is ~35-40% complete**
- **Verified complete**: P1.23, P1.26, P1.28, P1.37 (git config, clone pattern, keep-alive)
- **P1 items: 72** (66 + 6 new from iteration 4)
- **P2 items: 16**
- **P3 items: 15**
- **P4 items: 10**
- **P5 items: 12**
- **P6 items: 27**
- **Total items: 152**
- Security issues tracked: P1.49 (CRITICAL prompt injection), P1.62 (cap-drop), P1.68 (heredoc security), P1.71 (internal shell escaping)
- Critical fix needed: P1.65 (listByPrefix searches filesystem, not Docker daemon)

### Analysis Methodology (Jan 2026 - Iteration 4)
Three parallel research agents analyzed gaps:
1. **Spec Coverage Agent**: Compared all specs/* against plan items
2. **Code Path Agent**: Analyzed src/ for error paths and edge cases
3. **Legacy Comparison Agent**: Compared ralph.ts working code against Effect implementation

**Areas thoroughly covered**:
- Networking/firewall configuration (entrypoint.sh handles most)
- Container lifecycle (create, start, exec patterns documented)
- Error types and Effect patterns
- CLI argument parsing

**Areas needing implementation work**:
- Logging/telemetry subsystem (0% implemented, ~10% of total scope)
- Service layer tests (0% coverage on live layers)
- Dashboard event streaming integration
- Signal handling and graceful shutdown

### Items Already Implemented in Entrypoint/Firewall
The following are implemented in docker/entrypoint.sh and docker/init-firewall.sh:
- SSH key copying from `/root/.ssh` to `/tmp/.ssh/` with 700/600 permissions
- Git safe.directory configuration
- Docker DNS preservation during firewall init
- Firewall self-verification tests (blocked + allowed domains)
- GitHub IP CIDR aggregation via `aggregate` tool
- Host network auto-detection and whitelisting
These exist but weren't tracked in the plan - they work correctly.

### Spec Inconsistencies Identified (Jan 2026 - Iteration 5)
- **Timeout value inconsistency**: orchestrator.md:36 says "5-minute timeout", claude-integration.md:134 says "default 10 minutes", ralph.ts uses 1 hour
- **Resolution**: P1.57 uses 1-hour safety fallback per ralph.ts pattern (Claude handles its own timeouts)
- **Context window hardcoding**: specs/logging-telemetry.md:362-363 explicitly ties 200k to Opus 4, needs updating if model changes

### SSH vs HTTPS Git Configuration
Both are supported in parallel:
- SSH (port 22): For users with SSH keys configured
- HTTPS: Via `gh auth git-credential` helper for GitHub token users
- P1.23, P1.34, P1.45 cover the configuration but this clarifies the dual-path design intent

### Model Tiering Strategy (Future Enhancement, Out of Scope)
Per specs/zfc-architecture.md:251-259:
- Complex reasoning → Opus
- Simple checks → Sonnet
- Routing/classification → Haiku
Explicitly out of scope for MVP but architecture allows future enhancement

### Out of Scope Items (per specs/logging-telemetry.md:348-357)
NOT to be implemented (explicitly out of scope):
- Session browser UI
- Session summaries
- Cumulative token tracking across sessions
- Phase-level timing
- Thinking block toggle (hidden by default, no toggle)
- SQLite database (JSONL only)
- Git diff preview
- Search/filter functionality

---

## Blockers

### None Currently Identified
- All dependencies are internal
- No external service integrations pending
- Docker base image and firewall scripts are complete

---

## Implementation Notes

### ZFC Compliance (Critical Design Principle)
Per specs/zfc-architecture.md, the orchestrator must remain a "thin, safe, deterministic shell":
- All reasoning delegated to Claude
- Orchestrator handles only IO, plumbing, and policy enforcement
- No heuristic decision-making in orchestrator code

**Allowed Operations**:
- Pure IO: Read/write files, execute Docker commands, parse/serialize structured data
- Structural validation: JSON schema validation, required fields checks
- Policy enforcement: Max iterations budget, circuit breaker (3 no-change), timeout enforcement
- Mechanical transforms: Parameter substitution, CLI parsing, NDJSON stream parsing
- State management: Iteration tracking, progress monitoring, dashboard state updates
- Typed error handling: Use `_tag` discriminated unions, handle via `Effect.catchTag()`

**Forbidden Operations**:
- No ranking/scoring/selection: Cannot choose features based on complexity heuristics
- No semantic analysis: Cannot infer meaning from text content or keyword matching
- No heuristic classification: Cannot route based on keywords like "done", "complete", "error"
- No quality judgment: Cannot reject commits based on code quality scores
- No pattern matching on AI output: Must use structured data (features.json) or exit codes

### Branch Naming Convention
`ralph/MMDD-HHMM-{feature-slug}` per specs/orchestrator.md

### CI Gate Requirement (Critical)
Per specs/features.md and specs/orchestrator.md, Claude must run full CI suite before marking ANY feature as `passes: true`:
1. `bun run typecheck` (or project equivalent)
2. `bun test` (or project equivalent)
3. `bun run build` (if build script exists)
4. Feature's `verify_command` (if present)

**Rules (ZFC-compliant, enforced by Claude)**:
- Claude CANNOT mark `passes: true` until ALL checks pass
- Claude CANNOT commit until ALL checks pass
- Claude CANNOT move to next feature until ALL checks pass
- If CI fails, Claude must fix issues and rerun CI

### Phased Implementation for Logging (per specs/logging-telemetry.md:300-330)
- Phase 1: LoggingService with JSONL append, iteration boundaries, recovery endpoints
- Phase 2: Iteration sidebar with metrics, click to load, status indicators
- Phase 3: Activity log improvements (expand, highlight, prompt display)
- Phase 4: Subagent tracking (Task tool timing)
- Phase 5: Prompt editing and re-run functionality

### Priority Summary (Updated Jan 2026 - Iteration 11)
| Priority | Category | Items | Status |
|----------|----------|-------|--------|
| P1 | Critical Integration | 154 items | Blocking basic functionality (includes 7 CRITICAL security: P1.49, P1.81, P1.82, P1.118, P1.119, P1.143, P1.144; 3 verified complete; 12 new items from iteration 11) |
| P2 | Dashboard Integration | 56 items | Core UX features (7 new dashboard/UI gaps from iteration 11) |
| P3 | Missing Functionality | 23 items | Logging/telemetry subsystem + streaming |
| P4 | Robustness | 20 items | Production readiness |
| P5 | Test Coverage | 39 items | Quality assurance (13 new test gaps from iteration 11, including 2 P0 security tests) |
| P6 | Dashboard & Streaming Integration | 33 items | Event streaming, state sync, lifecycle |
| **Total** | | **325 items** | ~35% complete |

**Key Findings Iteration 11 (Jan 2026 - Parallel 4-Agent Research)**:
- **NEW P1.143-P1.154**: 12 new P1 items from comprehensive 4-agent parallel analysis
  - P1.143: Environment variable injection in volume mounts (HIGH SECURITY)
  - P1.144: Shell injection in ralph.ts Docker create (HIGH SECURITY)
  - P1.145: Race condition in firewall initialization (MEDIUM SECURITY)
  - P1.146: GitHub API response injection risk (MEDIUM SECURITY)
  - P1.147: Path traversal in dashboard static file serving (MEDIUM SECURITY)
  - P1.148: Unvalidated sessionId in container name generation (MEDIUM SECURITY)
  - P1.149: Dashboard broadcast missing in orchestration loop (CRITICAL)
  - P1.150: Error recovery strategy not implemented (CRITICAL)
  - P1.151: Dashboard state running=false in cleanup missing
  - P1.152: Step mode checkpoint not in mainLoop
  - P1.153: Structured error handling with catchTag missing
  - P1.154: Iteration state missing containerName
- **NEW P2.50-P2.56**: 7 new P2 items from dashboard component analysis
  - P2.50: Terminal.tsx is dead code (unused xterm component)
  - P2.51: Prompt template editing UI missing
  - P2.52: tool_result content block not handled in ActivityLog
  - P2.53: Iteration display missing feature name
  - P2.54: ClaudeMessageEvent.usage type mismatch
  - P2.55: No context window constant in dashboard
  - P2.56: SSE reconnect lacks exponential backoff
- **NEW P5.27-P5.39**: 13 new test coverage gaps
  - P5.27-P5.28: P0 security tests for shell injection (ClaudeLive prompt, DockerLive prefix)
  - P5.29: DockerLive.exec user parameter validation tests
  - P5.30-P5.33: Stream utility tests (parseNDJSONWithFallback, fromReadableStream, collectAll, forEach)
  - P5.34-P5.39: Error path, CORS, timeout, and entry point tests
- **Security Analysis**: 6 new security vulnerabilities identified (2 HIGH, 4 MEDIUM severity)
- **Test Analysis**: Identified 2 P0 (security), 7 P2 (correctness), 12 P3 (utilities) test gaps

**Key Findings Iteration 10 (Jan 2026 - Parallel 3-Agent Research)**:
- **NEW P1.127-P1.142**: 16 new P1 items from comprehensive gap analysis
  - P1.127: Path traversal in readFile/writeFile operations (SECURITY)
  - P1.128: Missing containerName parameter validation (SECURITY)
  - P1.129: Unvalidated JSON.stringify in SSE broadcasts (potential XSS)
  - P1.130: Unhandled async errors in DashboardLive fetch handler
  - P1.131: Effect.runSync in async context deadlock risk
  - P1.132: features.filter type check (TypeError on non-array)
  - P1.133: SSE client controller memory leak on error
  - P1.134: Docker exec process leak on stream parse error
  - P1.135: ConfigLive git root Command missing BunContext
  - P1.136: GitLive hasUnpushedCommits fails on detached HEAD
  - P1.137: mainLoop circuit breaker off-by-one logic
  - P1.138: ConfigLive GITHUB_TOKEN empty string vs undefined
  - P1.139: SSH volume mount path mismatch (/root/.ssh vs /home/node/.ssh)
  - P1.140: Missing .gitconfig volume mount in program.ts
  - P1.141: Container name format mismatch vs cleanup filter
  - P1.142: Git clone SSH key path conflict with entrypoint.sh
- **NEW P2.34-P2.49**: 16 new P2 items from dashboard analysis
  - P2.34: Missing iteration sidebar UI component
  - P2.35: Tool calls collapsed by default (opposite of spec)
  - P2.36: Thinking blocks visible (should be hidden)
  - P2.37: No syntax highlighting for tool output
  - P2.38: No prompt display at iteration start
  - P2.39: No /logs/:iteration endpoint
  - P2.40: No /iterations endpoint
  - P2.41: No /rerun endpoint
  - P2.42: No subagent Task tool timing tracker
  - P2.43: No session recovery on browser refresh
  - P2.44: No IterationMetrics interface in types
  - P2.45: No iteration_start event type in DashboardEvent
  - P2.46: Claude event token data not extracted for metrics
  - P2.47: No .ralph/sessions directory structure
  - P2.48: SSE error reconnection creates orphaned EventSource
  - P2.49: No prompt editing UI for re-runs
- **NEW P5.23-P5.26**: 4 new test coverage items
  - P5.23: Path traversal prevention tests
  - P5.24: Container name validation tests
  - P5.25: SSE client memory leak tests
  - P5.26: Detached HEAD git state tests
- **Security Analysis**: 3 additional security gaps found (path traversal, containerName injection, SSE XSS)
- **Resource Leak Analysis**: 3 memory/resource leaks identified (SSE controllers, docker exec, missing context)
- **Major Finding**: SSH key volume mount path mismatch breaks git operations in container

**Key Findings Iteration 9 (Jan 2026 - Parallel 3-Agent Research)**:
- **NEW P1.118-P1.126**: 9 new P1 items from comprehensive gap analysis
  - P1.118-P1.119: Additional command injection vectors in git branch parameter (CRITICAL SECURITY)
  - P1.120: Effect.scoped stream resource leak in DockerLive.execStream
  - P1.121-P1.122: parseInt NaN validation for maxIterations and dashboardPort
  - P1.123: Container state verification after firewall wait
  - P1.124: createSession partial failure container leak
  - P1.125: Initial remainingFeaturesCount logic bug
  - P1.126: CircuitBreaker check timing issue
- **NEW P2.31-P2.33**: 3 dashboard items (CORS, backpressure, error suppression)
- **NEW P3.22-P3.23**: 2 critical logging items (LoggingService interface and LoggingLive layer)
- **NEW P4.19-P4.20**: 2 robustness items (container start timeout, session ID collision)
- **NEW P5.21-P5.22**: 2 test coverage items (stale container parsing, branch parameter)
- **NEW P6.28-P6.33**: 6 Effect implementation patterns from ralph.ts comparison
- **Security Analysis**: Extended P1.81 with 2 additional callsites (P1.118 branch in checkout/fetch, P1.119 branch in clone)
- **Major Finding**: Circuit breaker check happens AFTER loop exits - timing bug may prevent error reporting

**Key Findings Iteration 8 (Jan 2026 - Parallel 3-Agent Research)**:
**Key Findings Iteration 13 (Jan 2026 - Deep Type Safety & Test Coverage Analysis)**:
- **NEW P1.155-P1.165**: 11 new P1 items from type safety analysis
  - P1.155: Generic JSON parse without runtime validation (ndjson.ts)
  - P1.156: Request body type assertions without validation (server.ts)
  - P1.157: Non-null assertion in SSE cancel callback (DashboardLive.ts)
  - P1.158: `any` instead of `unknown` in error handler (ClaudeLive.ts)
  - P1.159: Defined but unused error types (ContainerNotFoundError, FeatureError, ValidationError)
  - P1.160: Effect.catchAll loses type discrimination (main.ts)
  - P1.161: No retry logic for transient failures (all layers)
  - P1.162: Docker inspect partial failure (DockerLive.ts)
  - P1.163: Git dual command partial failure (GitLive.ts)
  - P1.164: String-based timeout tag check fragility (ClaudeLive.ts)
  - P1.165: DashboardError interface without class implementation
- **NEW P2.56-P2.57**: 2 new P2 items (error display, prompt display in dashboard)
- **NEW P3.27**: JSONL session file writing not implemented
- **NEW P4.24-P4.27**: 4 new P4 items (model version, timeout, MIME types, console localhost)
- **NEW P5.33-P5.38**: 6 new P5 items (stream utility tests, array assertions, service layer tests)
- **NEW P6.38-P6.41**: 4 new P6 items (as any workarounds, type inconsistencies, error truncation)
- **Analysis Coverage**: Type safety (11 issues), Test coverage (6 gaps), Error handling (5 issues)
- **Major Finding**: Stream utilities (ndjson.ts) have only parseNDJSON tested; 4 other utilities completely untested
- **Security Note**: P1.155-P1.156 are lower priority than P1.49/P1.81/P1.82 command injections

**Key Findings Iteration 8 (Jan 2026 - Comprehensive Gap Analysis)**:
- **NEW P1.108-P1.117**: 10 new P1 items from comprehensive gap analysis
  - P1.108: DashboardLive missing REST endpoints (CRITICAL - dashboard non-functional without these)
  - P1.109: onStopCallback registration for dashboard stop button
  - P1.110: ClaudeLive stderr stream abandoned (CRITICAL - can cause process blocking)
  - P1.111: GitHub .packages IP ranges missing from firewall
  - P1.112: Feature schema extended fields not supported
  - P1.113: Initial SSE connection events incomplete
  - P1.114: import.meta.dir vs process.cwd() path resolution
  - P1.115: JSON.parse in pure function without error handling
  - P1.116: hasUnpushedCommits error vs empty distinction
  - P1.117: DashboardLive async/await mixed with Effect
- **NEW P2.25-P2.30**: 6 new P2 items (dashboard REST endpoints, MIME types, error messages)
- **NEW P5.19-P5.20**: 2 new P5 items (stderr tests, host network tests)
- **Analysis Coverage**: Source code analysis (20 issues), Legacy comparison (10 gaps), Spec coverage (24 gaps)
- **Major Finding**: DashboardLive is structurally incomplete - has SSE but no REST API for controls

**Key Findings Iteration 7 (Jan 2026 - Parallel 3-Agent Research)**:
- **NEW P1.89-P1.107**: 19 new P1 items from comprehensive gap analysis
  - P1.89: Stream cancellation resource leak in ClaudeLive
  - P1.90: DashboardLive SSE controller type safety
  - P1.91: Race condition in SSE client tracking
  - P1.92: Feature array element validation
  - P1.93: Git root detection staleness
  - P1.94: Effect.sleep duration type safety
  - P1.95: Templates directory existence validation
  - P1.96: Iteration state invariants
  - P1.97: Double error wrapping in DockerLive
  - P1.98: Git history linearity assumption
  - P1.99: Dual dashboard state risk
  - P1.100: NDJSON buffer pop pattern for chunk boundaries
  - P1.101: Dual-mode Claude spawn pattern
  - P1.102: Pause polling dual exit conditions
  - P1.103: Parallel stream processing with proc.exited race
  - P1.104: JSON parse fallback to raw output (not skip)
  - P1.105: Heredoc inline in docker exec pattern
  - P1.106: Plan mode empty features array handling
  - P1.107: Dashboard server before container creation
- **NEW P2.21-P2.24**: Dashboard UX (iteration display, final verification, exit message, subagent tracker)
- **NEW P3.19-P3.21**: Logging (rerun endpoint, session recovery, error display)
- **NEW P4.14-P4.18**: Robustness (truncation indicator, partial init, network timeout, concurrent mod, circular deps)
- **NEW P5.15-P5.18**: Test coverage (SSE race, stream cancellation, feature validation, state invariants)
- **Analysis Coverage**: 36 gaps from spec research, 15 new issues from code analysis, 23 patterns from ralph.ts comparison
- **Major Finding**: Logging subsystem (P3) remains 0% implemented despite 21 items identified

**Key Findings Iteration 6 (Jan 2026 - Parallel 3-Agent Research)**:
- **NEW P1.78**: TextDecoder stream mode in DockerLive.execStream (data corruption risk)
- **NEW P1.79**: parsed.features property validation (unhandled TypeError)
- **NEW P1.80**: Docker exec exit code capture (silent failures)
- **NEW P1.81**: Git command injection in GitLive (CRITICAL SECURITY)
- **NEW P1.82**: Find command injection in listByPrefix (CRITICAL SECURITY)
- **NEW P1.83**: Error-tolerant command execution pattern (Bun .quiet().nothrow() equivalent)
- **NEW P1.84**: AbortSignal integration for Claude cancellation
- **NEW P1.85**: Stdin stream reader for CLI prompts (lock release pattern)
- **NEW P1.86**: SSH-only git operations fallback
- **NEW P1.87**: tool_result content type validation (string vs array)
- **NEW P1.88**: Empty string CLI argument handling
- **NEW P2.17-P2.20**: Dashboard UI enhancements (syntax highlighting, collapsible, tables, task timing)
- **NEW P3.16-P3.18**: Logging enhancements (session analysis, prompt display, status field)
- **NEW P4.11-P4.13**: Robustness improvements (NDJSON tolerance, content normalization, auth priority docs)
- **NEW P5.13-P5.14**: Test coverage (IP aggregation, SSH non-interactive)
- **Security Audit**: 3 CRITICAL command injection vulnerabilities identified (P1.49, P1.81, P1.82)
- **Data Corruption Risk**: TextDecoder without stream option corrupts multi-byte UTF-8 (P1.78)

**Key Findings Iteration 5 (Jan 2026 - Parallel Research with 3 Agents)**:
- **NEW P1.73**: server.ts Set.delete during iteration - undefined behavior
- **NEW P1.74**: Stream reader lock release pattern for stdin reads
- **NEW P1.75**: TextDecoder `{ stream: true }` option for multi-byte chars
- **NEW P1.76**: Remaining buffer processing after stream ends
- **NEW P1.77**: Container restart exit code verification
- **Spec Clarification**: Timeout values inconsistent across specs (5min vs 10min vs 1hr)
- **Spec Clarification**: SSH vs HTTPS git operations are dual-path by design
- **Spec Clarification**: Model tiering (Opus/Sonnet/Haiku) is future enhancement, out of MVP scope

**Key Findings Iteration 4 (Jan 2026 - Deep Gap Analysis)**:
- **NEW P1.67**: Docker image existence check before container creation
- **NEW P1.68**: Heredoc quoted EOF markers for security (prevents shell injection in file writes)
- **NEW P1.69**: Feature slug sanitization for valid branch names
- **NEW P1.70**: GitHub token CLI fallback via `gh auth token`
- **NEW P1.71**: Shell escaping in internal docker exec commands (distinct from P1.49)
- **NEW P1.72**: Thinking block filtering for dashboard display

**Key Findings Iteration 3 (Jan 2026 Parallel Research)**:
- **P6.9 CRITICAL**: DockerService.listByPrefix() searches filesystem not Docker daemon - elevated to P1.65
- **NEW P1.64**: GitService runs on host, should use DockerService.exec() for container git operations
- **NEW P1.65**: Add listContainersByPrefix() method for Docker daemon queries (fixes P6.9)
- **NEW P1.66**: .claude volume mount must be :rw not :ro for session state storage
- P1.23, P1.26, P1.28, P1.37 verified complete (git config, clone pattern, keep-alive)
- P1.49 Command Injection CONFIRMED - prompt strings not escaped in ClaudeLive.ts:41,89
- Logging subsystem (P3) is 0% implemented - complete gap, no LoggingService exists
- Test coverage verified at ~25% (utilities tested, service layers 0%)

**Duplicate Items to Consolidate**:
- P1.19 + P1.61 → Single "Dual-path unpushed commit detection" item
- P1.27 + P6.8 + P6.21 → Single "Firewall polling with 30s timeout" item
- P1.57 + P6.20 → Single "1-hour Claude safety timeout" item
- P5.2 + P5.9 → Single "createSession() tests" item
- P6.1 + P3.1 → Single "Use runWithEvents() for event streaming" item

### Dependency Graph
```
P1.9 Startup Cleanup ─────► P1.1 Main Entry Point (cleanup runs FIRST)
                                  │
P1.6 Environment Validation ──────┼─► P1.36 ANTHROPIC_API_KEY Fallback
                                  │
P1.39 Features.json Validation ───┤ (build mode only)
                                  │
P1.29 Create+Start Pattern ───────┼─► P1.37 Keep-Alive Command Consistency
                                  │
P1.38 Try-Finally Cleanup ────────┤
                                  │
                                  ├─► P1.23 Git Configuration in Container
                                  │         │
                                  │         └─► P1.26 --system vs --global Flag
                                  │         │
                                  │         └─► P1.34 Credential Helper Conditional
                                  │
                                  ├─► P1.10 Container Health Checks
                                  │
                                  ├─► P1.11 Branch Name Generation
                                  │         │
                                  │         └─► P1.13 Resume vs New Session
                                  │                   │
                                  │                   └─► P1.31 Host-Side Branch Verification
                                  │                   │
                                  │                   └─► P1.18 Clone Branch Selection
                                  │
                                  ├─► P1.17 Remote URL Extraction ─► Clone from remote
                                  │         │
                                  │         └─► P1.28 Clone via /tmp/repo
                                  │
                                  ├─► P1.33 .ralph Directory Creation
                                  │         │
                                  │         ├─► P1.12 Features.json Copying (build mode)
                                  │         │
                                  │         └─► P1.15 Prompt Template Write-to-Container
                                  │
                                  ├─► P1.25 Git Author Defaults
                                  │
                                  ├─► P1.2 Firewall Ready Detection
                                  │         │
                                  │         └─► P1.27 30-Second Polling Timeout
                                  │         │
                                  │         └─► P1.24 Firewall Verification
                                  │
                                  ├─► P1.3 copyToContainer (optional, for bulk ops)
                                  │
                                  ├─► P1.4 Final Verification Logic
                                  │         │
                                  │         └─► P1.20 PR Ready Command
                                  │         │
                                  │         └─► P1.35 Exit Message
                                  │
                                  ├─► P1.5 Signal Handling
                                  │         │
                                  │         └─► P1.16 AbortController Pattern
                                  │
                                  ├─► P1.7 --once Flag Handling ◄── P1.40 Pass Args to mainLoop
                                  │
                                  ├─► P1.8 maxIterations Enforcement ◄── P1.40
                                  │         │
                                  │         └─► P1.22 Circuit Breaker Timeout Handling
                                  │
                                  ├─► P1.19 Unpushed Commit Detection (dual paths)
                                  │
                                  ├─► P1.21 Container User Switching
                                  │
                                  ├─► P1.32 ralph-progress.txt (document only)
                                  │
                                  └─► P1.14 Plan Mode Completion Detection

P2.* Dashboard ────────────► Requires P1.1 complete first
     │
     ├─► P1.30 Dual Input Source Race (CLI + Dashboard)
     │
     ├─► P2.5 Interactive CLI Prompts (can test without dashboard)
     │
     ├─► P2.6 Plan Mode Iteration Reporting
     │
     ├─► P2.7 Dashboard Port Availability
     │
     ├─► P2.8 Static File Path Verification
     │
     ├─► P2.9 ZFC Compliance Audit
     │
     └─► P2.10 SSH Key Warning

P3.* Logging ──────────────► Can proceed in parallel with P2
     │
     ├─► P3.6 Session ID = Container Name
     │
     ├─► P3.7 iteration_start Event
     │
     ├─► P3.8 Context Window Percentage
     │
     └─► P3.9 Claude CLI Flag Verification

P4.* Robustness ───────────► After P1-P3 complete
     │
     ├─► P4.4 Retry Schedule Config
     │
     ├─► P4.5 Docker Daemon Check
     │
     └─► P4.6 JSONL Parse Tolerance

P5.* Testing ──────────────► After each priority phase
     │
     ├─► P5.6 ZFC Compliance Tests
     │
     ├─► P5.7 Firewall Detection Tests
     │
     ├─► P5.8 Signal Handling Tests
     │
     └─► P5.9 createSession Tests

New P1 Dependencies:
P1.41 Volume Mounts ────────► P1.1 Main Entry Point
P1.42 GIT_COMMITTER_* ──────► P1.25 Git Author Defaults
P1.43 Git Repo Validation ──► P1.6 Environment Validation
P1.44 CAP_NET_ADMIN Only ───► P1.29 Container Create Pattern
P1.45 UserKnownHostsFile ───► P1.23 Git Configuration
P1.46 Exit Code Validation ─► ZFC Compliance (architectural)
P1.47 Schema Validation ────► P1.39 Features.json Validation
P1.48 Empty Features ───────► P1.39 Features.json Validation

Jan 2026 New Dependencies:
P1.49 Command Injection ────► CRITICAL SECURITY (implement first)
P1.50 HOME Validation ──────► P1.6 Environment Validation
P1.51 CLI Numeric Validation ► P1.6 Environment Validation
P1.52 getRemainingFeatures ─► P4.6 JSONL Parse Tolerance
P1.53 Iteration Error Recovery ► P1.22 Circuit Breaker Timeout
P1.54 createSession Cleanup ─► P1.38 Try-Finally Cleanup
P1.55 Volume Mount Paths ───► P1.41 Volume Mounts
P1.56 RALPH_HOME Resolution ─► P1.15 Prompt Template Workflow
P1.57 1-Hour Safety Timeout ─► P4.2 Timeout Handling
P1.58 Timeout Error Detection ► ClaudeLive (standalone fix)
P1.59 Exec Exit Code ───────► P1.46 Exit Code Validation
P1.60 DashboardError ───────► P2.11 DashboardLive Error Type
P1.61 GitLive Dual-Path ────► P1.19 Unpushed Detection
P1.62 Cap-Drop ALL ─────────► P1.44 CAP_NET_ADMIN Only
P1.63 Template Naming ──────► P1.15 Prompt Template Workflow

P2 New Dependencies:
P2.11 DashboardLive Error ──► P1.60 DashboardError Definition
P2.12 Effect.runSync ───────► DashboardLive refactor
P2.13 Stale SSE Cleanup ────► P2.1 Dashboard Consolidation
P2.14 Dashboard Init Sequence ► P2.2 Connect Dashboard to Effect
P2.15 Container Name State ──► P2.2 Connect Dashboard to Effect
P2.16 No-Dashboard Mode ────► P2.2 Connect Dashboard to Effect

P3 New Dependencies:
P3.10 IterationMetrics ─────► P3.4 Iteration Metrics
P3.11 tool_result Type ─────► types.ts (standalone)
P3.12 Cost Aggregation ─────► P3.4 Iteration Metrics
P3.13 NDJSON Buffer ────────► P3.1 ClaudeService.runWithEvents
P3.14 Dual Stream Processing ► P3.1 ClaudeService.runWithEvents
P3.15 Dashboard Mode Flags ──► P3.14 Dual Stream Processing

P4 New Dependencies:
P4.7 Final Verification Reset ► P1.4 Final Verification Logic
P4.8 Iteration Check Order ──► mainLoop implementation
P4.9 Push Failure Handling ──► P1.19 Unpushed Detection
P4.10 Local Step Mode ──────► P2.3 Step Mode in Loop

P5 New Dependencies:
P5.10 Command Injection Tests ► P1.49 Command Injection Fix
P5.11 Error Recovery Tests ──► P1.53 Iteration Error Recovery
P5.12 Volume Mount Tests ───► P1.50 HOME Validation

P6 New Dependencies (Jan 2026 - Iteration 2):
P6.1 Event Streaming ─────────► P3.1 ClaudeService.runWithEvents
P6.2 Output vs Event ─────────► P6.1 Event Streaming
P6.3 NDJSON Error Handling ───► P6.2 Output vs Event
P6.4 Dashboard Cleanup ───────► P1.38 Try-Finally Cleanup
P6.5 Stderr Streaming ────────► P6.1 Event Streaming
P6.6 Buffer Management ───────► P6.3 NDJSON Error Handling
P6.7 Exec User Flag ──────────► P1.21 Container User Switching
P6.8 Logs Polling ────────────► P1.2 Firewall Ready Detection
P6.9 Docker PS Fix ───────────► P1.65 listContainersByPrefix (CRITICAL - now P1.65)
P6.10 Branch Verification ────► P1.31 Host-Side Branch Verification
P6.11 Clone Branch Selection ─► P1.18 Clone Branch Selection
P6.12 Push -u Verification ───► P1.19 Unpushed Detection
P6.13 New Branch Detection ───► P1.61 GitLive Dual-Path
P6.14 Features Error Tolerance ► P4.6 JSONL Parse Tolerance
P6.15 Features Write ─────────► P1.12 Features.json Copying
P6.16 Plan Mode Exit ─────────► P1.14 Plan Mode Completion
P6.17 Plan Mode Display ──────► P2.6 Plan Mode Iteration Reporting
P6.18 Second Signal ──────────► P1.5 Signal Handling
P6.19 Bell Character ─────────► P1.22 Circuit Breaker Timeout
P6.20 1-Hour Timeout ─────────► P1.57 1-Hour Safety Timeout
P6.21 Polling Interval ───────► P6.8 Logs Polling
P6.22 Entrypoint Lifecycle ───► Documentation (standalone)
P6.23 mainLoop Parameters ────► P1.40 Pass Args to mainLoop
P6.24 Volume Mount .gitconfig ─► P1.55 Volume Mount Paths
P6.25 Path Mapping ───────────► P6.24 Volume Mount .gitconfig
P6.26 Template File Read ─────► P1.15 Prompt Template Workflow
P6.27 Three Iteration Limits ─► P1.8 maxIterations Enforcement

New P1 Items (Jan 2026 - Iteration 3):
P1.64 GitService Container ───► P1.1 Main Entry Point (context must be correct)
P1.65 listContainersByPrefix ─► P1.9 Startup Cleanup (CRITICAL - was P6.9)
P1.66 .claude Write Access ───► P1.55 Volume Mount Paths

New P1 Items (Jan 2026 - Iteration 4):
P1.67 Docker Image Check ─────► P1.1 Main Entry Point (fail fast)
P1.68 Heredoc Quoted EOF ─────► P1.12 Features.json Copying, P1.15 Prompt Template
P1.69 Feature Slug Sanitize ──► P1.11 Branch Name Generation
P1.70 GitHub Token Fallback ──► P1.6 Environment Validation
P1.71 Shell Escaping Internal ► P1.21 Container User Switching (command construction)
P1.72 Thinking Block Filter ──► P6.2 Output vs Event Distinction

New P1 Items (Jan 2026 - Iteration 5):
P1.73 server.ts Set Mutation ─► P2.1 Remove Legacy server.ts (consolidation eliminates issue)
P1.74 Stream Reader Lock ─────► P2.5 Interactive CLI Prompts
P1.75 TextDecoder Stream ─────► P3.13 NDJSON Buffer Management
P1.76 Buffer Processing ──────► P3.13 NDJSON Buffer Management
P1.77 Container Restart Code ─► P1.10 Container Health Checks

New P1 Items (Jan 2026 - Iteration 6):
P1.78 TextDecoder Stream Mode ─► DockerLive.execStream (CRITICAL data corruption)
P1.79 parsed.features Validation ► P1.52 getRemainingFeatures Error Handling
P1.80 Docker Exec Exit Code ───► P1.59 Exec Exit Code Verification
P1.81 Git Command Injection ───► CRITICAL SECURITY (immediate fix needed)
P1.82 Find Command Injection ──► CRITICAL SECURITY (immediate fix needed)
P1.83 Error-Tolerant Commands ─► P1.9 Startup Cleanup, P1.20 PR Ready
P1.84 AbortSignal Integration ─► P1.16 AbortController Pattern
P1.85 Stdin Stream Reader ─────► P2.5 Interactive CLI Prompts
P1.86 SSH-Only Git Fallback ───► P1.34 Credential Helper Conditional
P1.87 tool_result Content Type ► P3.11 tool_result Type
P1.88 Empty String CLI Args ───► P1.51 CLI Numeric Validation

New P2 Items (Jan 2026 - Iteration 6):
P2.17 Syntax Highlighting ─────► Dashboard UI
P2.18 Collapsible Tool Calls ──► Dashboard UI
P2.19 Table Rendering ─────────► Dashboard UI
P2.20 Task Tool Timing ────────► P3.14 Dual Stream Processing

New P3 Items (Jan 2026 - Iteration 6):
P3.16 Session JSONL Analysis ──► Documentation
P3.17 Iteration Prompt Display ► P2.4 Prompt Template Editing
P3.18 IterationMetrics Status ─► P3.10 IterationMetrics Interface

New P4 Items (Jan 2026 - Iteration 6):
P4.11 Invalid NDJSON Tolerance ► P3.13 NDJSON Buffer Management
P4.12 Tool Result Normalization ► P1.87 tool_result Content Type
P4.13 Git Auth Priority Docs ──► Documentation

New P5 Items (Jan 2026 - Iteration 6):
P5.13 IP Aggregation Tests ────► P5.7 Firewall Detection Tests
P5.14 SSH Non-Interactive Tests ► P1.45 UserKnownHostsFile SSH Configuration

New P1 Items (Jan 2026 - Iteration 8):
P1.108 DashboardLive REST ───────► P2.1 Remove Legacy server.ts (migration of endpoints)
P1.109 onStopCallback ───────────► P1.16 AbortController Pattern
P1.110 stderr Stream Consumption ► P6.5 Separate Stderr Streaming
P1.111 GitHub .packages IPs ─────► Firewall (standalone)
P1.112 Feature Schema Fields ────► types.ts (standalone)
P1.113 Initial SSE Events ───────► P2.14 Dashboard State Init Sequence
P1.114 import.meta.dir Path ─────► P1.56 RALPH_HOME Resolution
P1.115 JSON.parse Error Handling ► P1.52 getRemainingFeatures Error Handling
P1.116 hasUnpushedCommits Error ─► P1.61 GitLive Dual-Path Implementation
P1.117 Async/Await Effect Mix ───► DashboardLive refactor

New P2 Items (Jan 2026 - Iteration 8):
P2.25 MIME Type Handling ────────► P2.1 Remove Legacy server.ts
P2.26 404 Error Message ─────────► P2.8 Static File Serving
P2.27 distDir Path Normalization ► P2.8 Static File Serving
P2.28 POST /rerun Endpoint ──────► P3.19 POST /rerun Implementation
P2.29 GET /iterations Endpoint ──► P3.20 Session Recovery
P2.30 GET /logs/:iteration ──────► P3.20 Session Recovery

New P5 Items (Jan 2026 - Iteration 8):
P5.19 stderr Stream Tests ───────► P1.110 stderr Stream Consumption
P5.20 Host Network Detection ────► Firewall tests (standalone)

New P1 Items (Jan 2026 - Iteration 9):
P1.118 Command Injection Branch ─► P1.81 Git Command Injection (branch parameter in checkout/fetch)
P1.119 Command Injection Clone ──► P1.81 Git Command Injection (branch in git clone)
P1.120 Exec Scoped Stream Leak ──► DockerLive.execStream resource leak
P1.121 parseInt NaN maxIterations ► P1.51 CLI Numeric Validation (infinite loop risk)
P1.122 parseInt NaN dashboardPort ► P1.51 CLI Numeric Validation (server bind failure)
P1.123 Container State After Sleep ► P1.10 Container Health Checks (verify running after firewall wait)
P1.124 createSession Partial Fail ► P1.54 createSession Cleanup (container leaks on partial failure)
P1.125 Initial remainingFeaturesCount ► Logic bug - starts at 0, should be unknown
P1.126 CircuitBreaker Check Timing ► Check happens after loop, may never trigger

New P2 Items (Jan 2026 - Iteration 9):
P2.31 Dashboard OPTIONS CORS ─────► CORS pre-flight handling for cross-origin
P2.32 SSE Broadcast Backpressure ─► Slow clients block entire broadcast loop
P2.33 Silent Catch in Broadcast ──► Overly broad error suppression

New P3 Items (Jan 2026 - Iteration 9):
P3.22 LoggingService Interface ───► specs/logging-telemetry.md:49-52 (not created)
P3.23 LoggingLive Layer ──────────► specs/logging-telemetry.md:335-344 (not implemented)

New P4 Items (Jan 2026 - Iteration 9):
P4.19 Container Start Timeout ────► docker start can hang indefinitely
P4.20 Session ID Collision Risk ──► Date.now() collision in concurrent scenarios

New P5 Items (Jan 2026 - Iteration 9):
P5.21 parseStaleContainers Format ► Fragile parsing of docker ps output
P5.22 Branch Parameter Undefined ─► Type says optional, code uses unconditionally

New P6 Items (Jan 2026 - Iteration 9):
P6.28 Push Failure noChangeCount ─► P4.9 Push Failure Handling (effect implementation)
P6.29 Push Success Resets Final ──► P4.7 Final Verification Reset (effect implementation)
P6.30 Firewall For-Loop Pattern ──► P1.27 explicit 30-iteration for-loop vs Effect.retry
P6.31 Iteration Boundary Sequence ► P4.8 all four checks in order before Claude run
P6.32 Dashboard Server Timing ────► P1.107 after createSession, before mainLoop
P6.33 Features Parse Silent Catch ► P6.14 try-catch with silent ignore pattern

New P1 Items (Jan 2026 - Iteration 10):
P1.127 Path Traversal ────────────► SECURITY (file path validation in DockerLive)
P1.128 containerName Validation ──► SECURITY (regex validation before interpolation)
P1.129 SSE JSON Sanitization ─────► SECURITY (XSS prevention in broadcasts)
P1.130 Async Fetch Error Handling ► DashboardLive refactor
P1.131 runSync Deadlock ──────────► DashboardLive refactor (use runPromise)
P1.132 features.filter Type Check ► P1.79 parsed.features Validation
P1.133 SSE Memory Leak ───────────► P2.13 Stale SSE Cleanup (immediate removal)
P1.134 Docker Exec Parse Leak ────► P1.120 Exec Scoped Stream Leak
P1.135 ConfigLive BunContext ─────► ConfigLive.ts standalone fix
P1.136 Detached HEAD Handling ────► P1.61 GitLive Dual-Path Implementation
P1.137 Circuit Breaker Logic ─────► P1.126 CircuitBreaker Check Timing
P1.138 Token Empty String ────────► P1.6 Environment Validation
P1.139 SSH Mount Path ────────────► P1.55 Volume Mount Paths (CRITICAL - breaks git)
P1.140 .gitconfig Mount ──────────► P1.55 Volume Mount Paths
P1.141 Container Name Format ─────► P1.65 listContainersByPrefix
P1.142 SSH Key Path Chain ────────► P1.139 SSH Mount Path (downstream of mount issue)

New P2 Items (Jan 2026 - Iteration 10):
P2.34 Iteration Sidebar ──────────► Dashboard UI (new component needed)
P2.35 Tool Calls Expanded ────────► ActivityLog.tsx fix
P2.36 Hide Thinking Blocks ───────► ActivityLog.tsx fix
P2.37 Syntax Highlighting ────────► P2.17 (expand with library integration)
P2.38 Prompt Display ─────────────► P3.17 Iteration Prompt Display
P2.39 /logs/:iteration ───────────► P2.30 GET /logs/:iteration
P2.40 /iterations Endpoint ───────► P2.29 GET /iterations Endpoint
P2.41 /rerun Endpoint ────────────► P2.28 POST /rerun Endpoint
P2.42 Task Tool Timing ───────────► P2.20 Task Tool Timing Visualizer
P2.43 Session Recovery ───────────► P3.20 Session Recovery on Reconnect
P2.44 IterationMetrics Type ──────► P3.10 IterationMetrics Interface
P2.45 iteration_start Event ──────► P3.7 iteration_start Event Schema
P2.46 Token Data Extraction ──────► P3.4 Iteration Metrics
P2.47 Sessions Directory ─────────► P3.2 LoggingService Implementation
P2.48 SSE Reconnection Fix ───────► useSSE.ts fix
P2.49 Prompt Editing UI ──────────► P2.4 Prompt Template Editing

New P5 Items (Jan 2026 - Iteration 10):
P5.23 Path Traversal Tests ───────► P1.127 Path Traversal
P5.24 Container Name Tests ───────► P1.128 containerName Validation
P5.25 SSE Memory Leak Tests ──────► P1.133 SSE Memory Leak
P5.26 Detached HEAD Tests ────────► P1.136 Detached HEAD Handling

New P1 Items (Jan 2026 - Iteration 12):
P1.143 Git Config User Escaping ──► SECURITY (git config user.name/email escape double quotes)
  - GitLive.ts:131-135 wraps name/email in double quotes but doesn't escape contents
  - `test@example.com"; rm -rf /` breaks out of quotes
  - Use single quotes or escape special chars

P1.144 HTTP Body Validation ──────► server.ts endpoint hardening
  - server.ts:246 `as { enabled: boolean }` is type assertion, not runtime validation
  - server.ts:275 `as { template: string }` same issue
  - Add runtime type checking (zod, joi, or manual validation)

P1.145 HTTP Endpoint Auth ────────► SECURITY (dashboard control endpoints)
  - server.ts:235-262 control endpoints have no authentication
  - Any network client can pause/resume/stop orchestrator
  - Add basic auth or token validation for control endpoints

P1.146 Async IIFE Error Handling ─► server.ts:245-252 and 274-280
  - Async IIFE in step-mode and prompt endpoints lack try-catch
  - JSON parsing errors crash handler
  - Wrap in try-catch with proper error response

P1.147 File Serve Race Condition ─► server.ts:194-209
  - `file.exists()` check separate from serving
  - File could be deleted between check and read
  - Use try-catch around read instead

P1.148 Silent Broadcast Errors ───► server.ts:35-39
  - SSE broadcast errors silently swallowed in catch block
  - Should log errors for debugging
  - Pattern: `try { client.enqueue } catch { clients.delete }`

P1.149 Dashboard Binding Address ─► server.ts network exposure
  - Dashboard binds to all interfaces (no host restriction)
  - Consider binding to localhost only by default
  - Add --dashboard-host CLI flag

P1.150 StrictHostKeyChecking ─────► program.ts:157 SSH security
  - `StrictHostKeyChecking=no` disables host key verification
  - Enables MITM attacks on git operations
  - Already noted in P1.45 but needs explicit fix

New P2 Items (Jan 2026 - Iteration 12):
P2.50 IterationSidebar Component ─► Dashboard UI (spec: logging-telemetry.md:79-111)
  - Display iteration cards with status indicators
  - Token count and context window percentage
  - Click to load iteration logs
  - Requires P3.22 LoggingService

P2.51 SubagentIndicator Component ► Dashboard UI (spec: logging-telemetry.md:183-230)
  - Track Task tool calls with timing
  - Display spinner with elapsed time
  - Show completion indicator with duration

P2.52 ToolCall Component ─────────► Dashboard UI (spec: logging-telemetry.md:343)
  - Dedicated component for formatted tool calls
  - Auto-detect language from file extension
  - Syntax highlighting integration

P2.53 Prompt Editing Re-run ──────► Dashboard UI (spec: logging-telemetry.md:232-258)
  - Editable prompt textarea
  - Edit & Re-run button
  - Creates new iteration with modified prompt

P2.54 Activity Log Thinking ──────► Dashboard UI (spec: logging-telemetry.md:167-169)
  - Hide thinking blocks by default
  - Currently visible when expanded (ActivityLog.tsx:51-59)

P2.55 Tool Calls Default Expand ──► Dashboard UI (spec: logging-telemetry.md:115)
  - Tool calls should be expanded by default
  - Currently collapsed (ActivityLog.tsx:74 `expanded: false`)

New P3 Items (Jan 2026 - Iteration 12):
P3.24 POST /rerun Endpoint ───────► server.ts (spec: logging-telemetry.md:328)
  - Re-run iteration with modified prompt
  - Creates new iteration
  - Requires LoggingService integration

P3.25 useSessionRecovery Hook ────► dashboard (spec: logging-telemetry.md:260-284)
  - Load iteration list from /iterations
  - Load current iteration events from /logs/:iteration
  - Restore activity panel from JSONL

P3.26 Iteration Boundary Emit ────► program.ts (spec: logging-telemetry.md:59-77)
  - Emit iteration_start event at iteration boundaries
  - Required for JSONL file structure
  - Integrate with LoggingService

New P4 Items (Jan 2026 - Iteration 12):
P4.21 CLI Port Validation ────────► args.ts:43 dashboardPort
  - No range check (could be 0, negative, or > 65535)
  - Add validation: 1-65535

P4.22 CLI maxIterations Validation ► args.ts:36
  - No range check (could be 0 or negative)
  - Add validation: >= 1

P4.23 HOME Env Manipulation ──────► program.ts:37-39 volume mounts
  - Uses process.env.HOME directly for volume paths
  - If HOME manipulated, wrong directory mounted
  - Validate HOME path before use

New P5 Items (Jan 2026 - Iteration 12):
P5.27 Integration Test: DockerLive ► No tests for actual Docker command execution
  - DockerLive.ts:40-319 completely untested against real Docker
  - Need tests for create, start, remove, exec, inspect

P5.28 Integration Test: ClaudeLive ► No tests for Claude CLI invocation
  - ClaudeLive.ts:21-100+ untested against real Claude
  - Need mock Claude responses for testing

P5.29 Integration Test: GitLive ──► No tests for git operations in containers
  - GitLive.ts:19-135 untested
  - Need tests for checkout, fetch, push, configureUser

P5.30 Integration Test: Server ───► No tests for HTTP endpoints
  - server.ts:213-300 untested
  - Need tests for all endpoints (events, pause, resume, stop, prompt)

P5.31 Integration Test: createSession ► program.ts:23-200 untested
  - Complex 7-step initialization flow
  - Need tests for error handling at each step

P5.32 Test Coverage: DashboardLive ► No tests for SSE server lifecycle
  - DashboardLive.ts:111-187 untested
  - Need tests for connection handling, broadcasting

New P6 Items (Jan 2026 - Iteration 12):
P6.34 DashboardLive Control Endpoints ► P2.1 Remove Legacy server.ts
  - DashboardLive.ts only implements SSE + static files
  - Missing: pause, resume, step-mode, stop, prompt endpoints
  - Need to port from server.ts or consolidate

P6.35 FeatureEvent Not Broadcast ─► types.ts vs implementation
  - FeatureEvent type exists (types.ts:46-52)
  - Only FeaturesEvent (full list) ever broadcast
  - Spec says individual status updates should use FeatureEvent

P6.36 Terminal Component Unused ──► Dashboard architecture decision
  - Terminal.tsx exists but not used in App.tsx
  - ActivityLog.tsx used instead
  - Either remove Terminal.tsx or integrate it

P6.37 Effect Implementation Gap ──► program.ts vs ralph.ts
  - Legacy ralph.ts implements all spec features
  - Effect src/program.ts missing: cleanup stale containers, ensure running, step mode, final verification
  - Two parallel implementations create maintenance burden

New P1 Items (Jan 2026 - Iteration 13):
P1.155 Generic JSON Parse Type Safety ► src/streams/ndjson.ts:24,54
  - JSON.parse() result cast to generic `T` without runtime validation
  - `JSON.parse(line) as T` assumes structure matches expected type
  - Add zod/io-ts schema validation or type guard function
  - Affects parseNDJSON() and parseNDJSONWithFallback()

P1.156 Request Body Type Assertions ──► server.ts:246,275
  - `req.json() as { enabled: boolean }` lacks runtime validation
  - `req.json() as { template: string }` same issue
  - Malformed requests pass type assertions silently
  - Add JSON schema validation before type assertion

P1.157 Non-Null Assertion in SSE Cancel ► DashboardLive.ts:148
  - `newClients.delete(clientController!)` uses non-null assertion
  - TypeScript doesn't narrow type inside nested cancel() callback
  - Could be undefined if cancel called before controller assigned
  - Store controller reference before ReadableStream creation

P1.158 any Instead of unknown in ClaudeLive ► ClaudeLive.ts:120
  - `Stream.mapError((e: any) => {` should use `unknown`
  - Allows accidental property access without type checking
  - Change to `(e: unknown)` and use proper type guards

P1.159 Unused Error Types Definition Gap ► errors/index.ts
  - ContainerNotFoundError defined (line 20-22) but never instantiated
  - FeatureError defined (line 46-50) but never instantiated
  - ValidationError defined (line 63-67) but never instantiated
  - Either use these error types or remove them

P1.160 Effect.catchAll Loses Type Info ► main.ts:64
  - Uses `Effect.catchAll` instead of `Effect.catchTag`
  - All errors stringified identically, losing type discrimination
  - Should use catchTag for CircuitBreakerError, TimeoutError, etc.
  - Pattern: specific handlers for expected errors, catchAll as fallback

P1.161 No Retry Logic for Transient Failures ► src/layers/*.ts
  - No usage of Effect.retry anywhere in codebase
  - Docker operations fail immediately without retry
  - Git push failures should retry with exponential backoff
  - Add Effect.retry with Schedule for network operations

P1.162 Docker Inspect Partial Failure ► DockerLive.ts:137-197
  - Makes 3 separate docker inspect calls (lines 140-157, 160-177, 180-197)
  - If first call succeeds but second fails, partial data is lost
  - Should use single inspect call with JSON format
  - Or atomic operation with all-or-nothing semantics

P1.163 Git Dual Command Partial Failure ► GitLive.ts:77-110
  - hasUnpushedCommits makes 2 sequential git commands
  - Branch command at lines 80-91, log command at 94-107
  - If branch succeeds but log fails, no cleanup
  - Add transaction pattern or atomic operation

P1.164 String-Based Timeout Tag Check ► ClaudeLive.ts:54,121
  - `e._tag === "TimeoutException"` is fragile string comparison
  - Effect might change tag structure in future versions
  - Use Effect's provided type guards or pattern matching
  - Replace with `Effect.isTimeoutException(e)` or similar

P1.165 DashboardError Interface Only ► services/Dashboard.ts:4-8
  - Interface defined but no corresponding Data.TaggedError class
  - Cannot use with Effect.catchTag() pattern
  - DashboardLive never throws this error type
  - Create matching class in errors/index.ts

New P2 Items (Jan 2026 - Iteration 13):
P2.56 Error Display in Activity Log ──► Dashboard UI (spec: logging-telemetry.md:287-298)
  - Inline error events for timeouts, failures, docker errors
  - Format: box with ⚠️ icon and error details
  - Update iteration card status to show failure (✗)
  - Currently errors not specially formatted

P2.57 Prompt Display at Iteration Start ► Dashboard UI (spec: logging-telemetry.md:170-181)
  - Show the prompt sent to Claude at top of activity log
  - Bordered box format with "Prompt" header
  - Store prompt in iteration state or JSONL events
  - Currently prompts not displayed

New P3 Items (Jan 2026 - Iteration 13):
P3.27 JSONL Session File Writing ──────► LoggingService (spec: logging-telemetry.md:59-77)
  - Write events to `.ralph/sessions/{session-id}.jsonl`
  - Raw Claude events passed through without modification
  - One event per line (newline-delimited JSON)
  - File naming matches container name
  - Currently no JSONL file writing - events only broadcast via SSE

New P4 Items (Jan 2026 - Iteration 13):
P4.24 Hardcoded Model Version ─────────► ClaudeLive.ts:27,76
  - `--model claude-opus-4-5-20251101` hardcoded
  - Should be configurable via ConfigService
  - Allow CLI flag `--model` or env var MODEL
  - Future-proofs against model updates

P4.25 Hardcoded 10-Minute Timeout ─────► program.ts:244
  - `timeoutMs: 10 * 60 * 1000` hardcoded
  - Conflicts with P1.57 (1-hour safety timeout)
  - Should be configurable via CLI or config
  - Already noted but not linked to source location

P4.26 Hardcoded MIME Types ────────────► server.ts:176-185
  - Static MIME_TYPES map limited to 8 extensions
  - Missing common types: .woff, .woff2, .map, .txt, .md
  - Consider using mime-types library
  - Or expand static map for all dashboard assets

P4.27 Hardcoded localhost in Console ──► server.ts:299
  - `console.log(\`Dashboard at http://localhost:${port}\`)`
  - Should use actual binding address
  - Could be 0.0.0.0 or specific interface
  - Misleading when binding to non-localhost

New P5 Items (Jan 2026 - Iteration 13):
P5.33 Test: parseNDJSONWithFallback ───► ndjson.ts:41-60 (no tests)
  - Returns discriminated union of parsed JSON or raw text
  - No dedicated tests for fallback behavior
  - Add tests for valid JSON, invalid JSON, mixed content

P5.34 Test: fromReadableStream ────────► ndjson.ts:68-79 (no tests)
  - Converts WHATWG ReadableStream to Effect Stream
  - No tests for stream conversion
  - Add tests for normal flow, errors, cancellation

P5.35 Test: collectAll ───────────────► ndjson.ts:86-89 (no tests)
  - Collects stream into array
  - Simple utility but untested
  - Add basic collect test

P5.36 Test: forEach ──────────────────► ndjson.ts:97-101 (no tests)
  - Stream processing with side effects
  - Untested side effect handling
  - Add tests for callback invocation

P5.37 Test: Array Index Assertions ───► container.test.ts:77-78
  - Uses `result[0]!` and `result[1]!` without length checks
  - Tests could fail with cryptic error if array shorter
  - Add explicit length assertions before index access

P5.38 Test: Service Layer Integration ► No tests use DockerTest/ClaudeTest/GitTest
  - Test layers exist in src/layers/test/
  - Only program.test.ts uses TestLive composition
  - No individual service layer tests
  - Add tests for each layer using test mocks

New P6 Items (Jan 2026 - Iteration 13):
P6.38 as any Workarounds in Layers ───► ClaudeLive.ts:135, GitLive.ts:138, DashboardLive.ts:188
  - Documented workaround for Effect Context.Tag interface/class shadowing
  - Comment explains issue but doesn't solve it
  - Investigate proper Effect pattern for service implementation
  - May require Effect version upgrade or pattern change

P6.39 Type Inconsistency: GitError ────► services/Git.ts:3-7 vs errors/index.ts:38-42
  - Interface GitError in services/Git.ts has different structure
  - Class GitError in errors/index.ts uses Data.TaggedError
  - Interface declares `_tag` and `message` as required
  - Class has different property pattern
  - Consolidate to single source of truth

P6.40 Type Inconsistency: ClaudeError ► services/Claude.ts:4-8 vs errors/index.ts:25-29
  - Same issue as P6.39 for ClaudeError
  - Interface vs class mismatch
  - Consolidate definitions

P6.41 NDJSON Error Message Truncation ► ndjson.ts:28
  - `line.slice(0, 100)` truncates error context
  - Long JSON lines lose debugging info
  - Consider logging full line to debug output
  - Keep truncated in user-facing message

Iteration 13 Dependency Graph Additions:
P1.155 Generic JSON Parse ──────────► P4.6 JSONL Parse Tolerance
P1.156 Request Body Validation ─────► P1.144 HTTP Body Validation (extends)
P1.157 Non-Null SSE Cancel ─────────► P1.133 SSE Memory Leak
P1.158 any vs unknown ──────────────► Code quality (standalone)
P1.159 Unused Error Types ──────────► Error handling audit
P1.160 catchAll Type Loss ──────────► P1.153 Structured Error Handling
P1.161 Retry Logic ────────────────► P4.* Robustness category
P1.162 Docker Inspect Partial ─────► DockerLive refactor
P1.163 Git Dual Command Failure ───► P1.61 GitLive Dual-Path
P1.164 Timeout Tag Check ──────────► P1.58 Timeout Error Detection
P1.165 DashboardError Class ────────► P1.60 DashboardError TaggedError
P2.56 Error Display ───────────────► P3.20 Session Recovery
P2.57 Prompt Display ──────────────► P3.17 Iteration Prompt Display
P3.27 JSONL Session Files ─────────► P3.22 LoggingService Interface
P4.24 Model Version Config ────────► ConfigService extension
P4.25 Timeout Config ──────────────► P1.57 1-Hour Safety Timeout
P4.26 MIME Types ──────────────────► P2.8 Static File Serving
P4.27 Console localhost ───────────► P1.149 Dashboard Binding Address
P5.33-P5.36 Stream Utils Tests ────► P5.* Test coverage
P5.37 Array Index Tests ───────────► Test quality
P5.38 Service Layer Tests ─────────► P5.27-P5.32 Integration Tests
P6.38 as any Workarounds ──────────► Effect architecture
P6.39-P6.40 Type Inconsistency ────► Error type consolidation
P6.41 Error Truncation ────────────► P4.6 JSONL Parse Tolerance

New P1 Items (Jan 2026 - Iteration 14):
P1.166 No Stale Container Cleanup at Startup ► src/program.ts, src/main.ts
  - Spec requires cleanupStaleContainers() at startup (specs/orchestrator.md:12)
  - Legacy ralph.ts:136-142 implements this correctly
  - Effect-based src/main.ts has no cleanup before createSession
  - parseStaleContainers() utility at src/container.ts:27-29 exists but unused
  - Add stale container detection and removal before session creation

P1.167 DockerService.listByPrefix Lists Files Not Containers ► DockerLive.ts:292-318
  - Spec expects listByPrefix() to list containers by name (specs/orchestrator.md:59)
  - Implementation at DockerLive.ts:292-318 lists files inside a container
  - Comment at Docker.ts:118 says "List files in a container by prefix"
  - Need new method listContainersByPrefix(prefix: string) in DockerService
  - Use `docker ps -a --filter name=...` pattern from ralph.ts:137

P1.168 No Cleanup in Finally Block ► src/main.ts:52-68, src/program.ts:283-335
  - Spec requires cleanupSession(containerName) in finally (specs/orchestrator.md:50)
  - Legacy ralph.ts:628-635 implements finally block with cleanup
  - Effect-based main.ts/program.ts have no finally block
  - Container left running after orchestration completes or fails
  - Add Effect.ensuring() or Effect.acquireRelease pattern for cleanup

P1.169 No Container Health Check Per Iteration ► src/program.ts:283-335
  - Spec requires ensureContainerRunning() each iteration (specs/orchestrator.md:29)
  - Legacy ralph.ts:461 checks container before each iteration
  - Legacy ralph.ts:144-152 implements restart on stopped container
  - Effect-based mainLoop has no health check
  - parseContainerRunning() at container.ts:34-36 exists but unused

P1.170 Missing finalVerificationDone State ► src/program.ts:289-291
  - Spec requires finalVerificationDone tracking (specs/orchestrator.md:129)
  - Legacy ralph.ts:430,484-491,566 implements full logic
  - Effect.iterate state at program.ts:291 only has: iteration, noChangeCount, remainingFeaturesCount
  - Won't run final verification iteration when all features pass
  - Add finalVerificationDone boolean to state and implement logic

P1.171 Missing Dashboard Integration in mainLoop ► src/program.ts:283-335
  - Spec requires DashboardService.updateState() calls (specs/orchestrator.md:244)
  - Legacy ralph.ts:477-478 broadcasts features and iteration via updateFeatures/updateIteration
  - Effect mainLoop never accesses DashboardService
  - No calls to dashboard.setIteration(), dashboard.setFeatures(), etc.
  - Dashboard won't update during orchestration

P1.172 Missing Step Mode in mainLoop ► src/program.ts:283-335
  - Spec requires step mode checkpoint after iterations (specs/orchestrator.md:147-152)
  - Legacy ralph.ts:572-606 implements step mode with CLI prompt and dashboard pause
  - Effect mainLoop has no step mode logic
  - No pausing between iterations, no user prompts

P1.173 Timeout Errors Should Continue Not Abort ► src/program.ts:241-251
  - Spec says TimeoutError → increment noChangeCount, continue (specs/orchestrator.md:232)
  - Current code: if Claude times out, Effect fails and propagates up
  - Should catch TimeoutError, increment noChangeCount, continue to next iteration
  - Add Effect.catchTag("TimeoutError") in runIteration

P1.174 Missing Max Iterations Check ► src/program.ts:295-297
  - Spec default: --max-iterations 50 (specs/orchestrator.md:181)
  - Legacy ralph.ts:453-456 enforces max iterations limit
  - Effect.iterate while condition only checks remainingFeaturesCount and noChangeCount
  - Loop continues indefinitely if features never pass
  - Add state.iteration < config.maxIterations to while condition

P1.175 DashboardLive Missing Control Endpoints ► DashboardLive.ts:111-179
  - Spec defines /pause, /resume, /step-mode, /stop, /prompt endpoints (specs/dashboard.md:26-36)
  - DashboardLive.ts only implements /events and static file serving
  - server.ts implements all endpoints but is mutable state version
  - Either add endpoints to DashboardLive or integrate server.ts
  - Critical for dashboard UI functionality

P1.176 Missing Logging Endpoints ► server.ts, DashboardLive.ts
  - Spec requires /iterations, /logs/:iteration, /rerun (specs/logging-telemetry.md:274-284)
  - Neither server.ts nor DashboardLive.ts implements these
  - Required for state recovery on browser reconnect
  - Part of LoggingService feature (P3.22)

P1.177 Unprotected JSON.parse in getRemainingFeatures ► src/container.ts:42
  - JSON.parse(featuresJson) can throw SyntaxError
  - Called from program.ts:237 without error handling
  - Should wrap in Effect.try() or validate with FeatureError
  - Or use existing error type for feature parsing failures

P1.178 Silent Error Swallowing in DashboardLive ► DashboardLive.ts:29-34
  - broadcastToClients() has try-catch with empty catch block
  - Failed broadcasts silently ignored
  - Could mask client connection issues
  - At minimum log errors; consider propagating for retry

P1.179 copyToContainer Not Implemented ► DockerLive.ts:290
  - Returns Effect.dieMessage("Not implemented yet")
  - Causes program crash if called
  - Required for bulk file operations per Docker.ts:111-115
  - Implement using `docker cp` command

P1.180 --mode Flag Not Documented ► specs/orchestrator.md:173-181
  - src/args.ts:11,45-47 implements --mode (plan|build)
  - src/args.test.ts:120-143 tests all mode variations
  - Spec CLI argument table has no mention of --mode
  - Add to spec or remove from implementation

P1.181 maxIterations Comment Wrong in Service ► services/Config.ts:13
  - Comment says "default: 5"
  - Actual default is 50 (args.ts:14, specs/orchestrator.md:178)
  - Misleading documentation

P1.182 featuresPath Comment Wrong in Service ► services/Config.ts:11
  - Comment says "default: features.json"
  - Actual default is ".ralph/features.json" (args.ts:18, specs/features.md:3)
  - Missing .ralph/ prefix in comment

P1.183 Effect Config Missing ANTHROPIC_API_KEY ► ConfigLive.ts:35-47
  - Legacy ralph.ts:171 passes ANTHROPIC_API_KEY to container
  - Legacy ralph.ts:358-361 accepts either OAuth token OR API key
  - ConfigLive only reads CLAUDE_CODE_OAUTH_TOKEN
  - Add ANTHROPIC_API_KEY as optional alternative

P1.184 Effect Config Missing GIT_AUTHOR Vars ► ConfigLive.ts:35-47, program.ts:41-44
  - Legacy ralph.ts:173-174 passes GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL
  - Effect program.ts:41-44 only passes 2 env vars to container
  - Git commits inside container will have wrong author
  - Add GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL to config and container env

P1.185 No Validation for Numeric CLI Args ► args.ts:35-43
  - parseInt() results not validated for NaN, negative, or zero
  - --max-iterations -5 or --max-iterations abc silently accepted
  - --dashboard-port 99999 exceeds valid port range
  - Test at args.test.ts:87-90 confirms NaN accepted
  - Use ValidationError (currently unused) to reject invalid values

New P2 Items (Jan 2026 - Iteration 14):
P2.58 No Request Validation on POST/PUT Endpoints ► server.ts:244-280
  - POST /step-mode, PUT /prompt lack Content-Type check
  - JSON parsing errors not caught
  - Type assertions without runtime validation
  - Malformed requests silently pass or crash

P2.59 Inconsistent Error Response Format ► server.ts:196-208
  - Errors return plain text: new Response("Not found", { status: 404 })
  - Success responses return JSON: { paused: boolean }
  - Should use consistent JSON error format: { error: "...", code: "..." }

P2.60 DashboardLive Static Files No MIME Types ► DashboardLive.ts:171
  - Returns raw file without Content-Type header
  - Browsers must guess from extension
  - server.ts:199-204 sets MIME type properly

P2.61 State Counters Reset on Resume ► src/program.ts, src/container.ts
  - When resuming via --branch, iteration/noChangeCount reset to 0
  - Branch may have 10 commits but shows "Iteration 1"
  - Consider inferring iteration count from git log on resume

New P3 Items (Jan 2026 - Iteration 14):
P3.28 LoggingService Not Implemented ► logging-telemetry.md:302-306
  - Phase 1 feature entirely unimplemented
  - No LoggingService in src/services/
  - Required for: JSONL append, iteration markers, /logs endpoint, browser recovery
  - Blocking P1.176 logging endpoints

New P4 Items (Jan 2026 - Iteration 14):
P4.28 Volume Mount Paths Hardcoded ► program.ts:36-39
  - ~/.ssh, ~/.claude, templates paths hardcoded
  - Not configurable via CLI, env, or config
  - Users can't use non-standard locations
  - Consider adding --ssh-path, --claude-config-path options

P4.29 timeoutMs Not Configurable ► services/Config.ts:15, program.ts:244
  - Config interface declares timeoutMs with comment "default: 300000 (5 min)"
  - ConfigLive.ts:60 hardcodes 5 minutes
  - program.ts:244 hardcodes 10 minutes (different!)
  - Not exposed as CLI flag or environment variable
  - Spec doesn't document timeout configuration

New P5 Items (Jan 2026 - Iteration 14):
P5.39 Test: createSession() ──────────► program.ts:23-200 (no tests)
  - 180-line function with 8 major steps
  - Container creation, git ops, file system setup
  - Critical path completely untested
  - Add integration tests with DockerTest layer

P5.40 Test: startDashboardServer() ───► server.ts:213-301 (no tests)
  - SSE stream creation, client management
  - HTTP endpoint handlers
  - Static file serving
  - All untested

P5.41 Test: makeDashboardLive() ──────► DashboardLive.ts:9-202 (no tests)
  - Ref-based state management
  - SSE client tracking
  - HTTP server lifecycle
  - Complex logic untested

P5.42 Test: makeClaudeLive().run() ───► ClaudeLive.ts:21-67 (no tests)
  - Command building, timeout handling
  - Error mapping TimeoutException → TimeoutError
  - Untested

P5.43 Test: makeClaudeLive().runWithEvents() ► ClaudeLive.ts:69-134 (no tests)
  - NDJSON stream parsing
  - Timeout on streams
  - Error transformation
  - Complex stream logic untested

P5.44 Test: DockerLive methods ───────► DockerLive.ts (no tests)
  - writeFile stdin piping, inspect multi-call, listByPrefix find command
  - None have dedicated tests

P5.45 Test: GitLive.hasUnpushedCommits ► GitLive.ts:77-110 (no tests)
  - Two-step git command execution
  - Partial failure scenarios
  - Untested

P5.46 Test: ConfigLive layer ─────────► ConfigLive.ts (no tests)
  - detectGitRoot command execution
  - Environment variable loading
  - Edge cases: invalid git repo, missing token

New P6 Items (Jan 2026 - Iteration 14):
P6.42 Duplicate Error Type Definitions ► services/*.ts vs errors/index.ts
  - DockerError, GitError, ClaudeError, TimeoutError defined as both:
    - Plain interfaces in services/*.ts
    - Data.TaggedError classes in errors/index.ts
  - Different property structures cause confusion
  - Consolidate to single source of truth in errors/index.ts

P6.43 DashboardError Only Interface ──► services/Dashboard.ts:4-8
  - Interface defined but no TaggedError class
  - All DashboardService methods declare DashboardError in channel
  - DashboardLive never throws it
  - Either implement class or remove from signatures

P6.44 runSync in Async Context ───────► DashboardLive.ts:127-133, 145-150
  - Effect.runSync() used inside async SSE handlers
  - Can fail if Effect runtime in inconsistent state
  - Consider async pattern with Effect.runPromise

P6.45 docker find Errors Suppressed ──► DockerLive.ts:296
  - listByPrefix uses `|| true` to suppress find errors
  - Masks permission issues or invalid paths
  - Consider proper error handling or logging

Iteration 14 Dependency Graph Additions:
P1.166 Stale Cleanup ─────────────────► P1.1 Main Entry Point (blocks)
P1.167 listContainersByPrefix ────────► P1.166 Stale Cleanup (required by)
P1.168 Finally Cleanup ───────────────► P1.1 Main Entry Point (blocks)
P1.169 Container Health Check ────────► P1.9 ensureContainerRunning (same)
P1.170 finalVerificationDone ─────────► P1.4 Final Verification Logic (same)
P1.171 Dashboard Integration ─────────► P1.38 Dashboard Broadcast (same)
P1.172 Step Mode ─────────────────────► P1.43 Step Mode Implementation (same)
P1.173 Timeout Continue ──────────────► P1.58 Timeout Error Detection (extends)
P1.174 Max Iterations Check ──────────► P1.7 --once Flag (related loop control)
P1.175 DashboardLive Endpoints ───────► P1.42 Dashboard API Completeness (blocks)
P1.176 Logging Endpoints ─────────────► P3.28 LoggingService (blocked by)
P1.177 JSON.parse Safety ─────────────► P1.155 Generic JSON Parse (related)
P1.178 Silent Error Swallow ──────────► Error handling audit
P1.179 copyToContainer ───────────────► P1.3 copyToContainer (same)
P1.180 --mode Documentation ──────────► Spec completeness
P1.181-P1.182 Comment Fixes ──────────► Documentation accuracy
P1.183 ANTHROPIC_API_KEY ─────────────► P1.6 Environment Validation (extends)
P1.184 GIT_AUTHOR Vars ───────────────► Container config completeness
P1.185 Numeric Validation ────────────► P1.159 Unused Error Types (uses ValidationError)
P2.58 Request Validation ─────────────► P1.156 Request Body Validation (same)
P2.59 Error Response Format ──────────► API consistency
P2.60 MIME Types DashboardLive ───────► P4.26 Hardcoded MIME Types (related)
P2.61 Resume Counters ────────────────► State persistence
P3.28 LoggingService ─────────────────► P3.22 LoggingService Interface (same)
P4.28 Volume Paths ───────────────────► Config extensibility
P4.29 timeoutMs Config ───────────────► P4.25 Hardcoded Timeout (same)
P5.39-P5.46 Tests ────────────────────► Test coverage expansion
P6.42 Duplicate Error Types ──────────► P6.39-P6.40 Type Inconsistency (same)
P6.43 DashboardError Class ───────────► P1.165 DashboardError TaggedError (same)
P6.44 runSync in Async ───────────────► Effect patterns
P6.45 find Error Suppression ─────────► Error handling audit

New P1 Items (Jan 2026 - Iteration 15):
P1.186 Runtime Firewall Health Monitoring ► specs/networking.md, program.ts
  - Firewall initialized at startup but never re-verified during session
  - No detection if iptables rules are cleared or bypassed
  - Add periodic firewall health check (e.g., every 10 iterations)
  - Or verify firewall rules still active before sensitive operations

P1.187 Feature CI Verification Gap ► specs/features.md:101-124, program.ts:213-266
  - Spec: "CI suite must run after EVERY feature. Claude CANNOT mark passes: true until ALL checks pass"
  - Orchestrator has no mechanism to verify CI was actually run
  - Relies entirely on Claude's compliance with instructions
  - Consider: orchestrator could run verification commands itself before accepting passes: true

P1.188 AbortController Integration Missing ► ralph.ts:76-82, src/program.ts
  - Legacy ralph.ts maintains `claudeAbortController` for stopping Claude mid-execution
  - Effect-based code has no AbortController integration
  - Dashboard stop button and SIGINT need to abort running Claude process
  - Required for P1.5 (Signal Handling) and P1.16 (Dashboard Stop Button)

P1.189 Session Cost Aggregation ► specs/claude-integration.md:212-224, src/program.ts
  - Spec: "Cost can be aggregated across iterations for total session cost"
  - ClaudeResultEvent contains cost_usd field
  - No session-level cost accumulator in Effect implementation
  - Add totalCost field to iteration state or dashboard state

P1.190 Error Classification Audit ► specs/README.md:104-110, src/program.ts, src/errors
  - Spec categorizes: Fatal errors (exit immediately) vs Recoverable errors (retry/continue)
  - Current implementation treats most errors as fatal (Effect.fail propagates)
  - Need systematic review: which errors should retry, which should exit
  - Example: TimeoutError should continue (spec says so), but currently exits

P1.191 Container Exec User Flag Consistency ► ralph.ts:208-215, DockerLive.ts:139-187
  - Legacy ralph.ts uses `-u node` for git operations, root for chown
  - DockerLive.exec() has userOverride parameter but not consistently used
  - createSession in program.ts doesn't pass user flags for git operations
  - Git commands may run as wrong user, causing permission issues

P1.192 Remote URL Extraction Before Clone ► ralph.ts:201, program.ts:79-92
  - Legacy ralph.ts extracts remote URL: `git remote get-url origin`
  - Effect program.ts clones from `sessionConfig.gitRoot` (local path)
  - Should clone from remote URL to ensure clean state (no uncommitted changes)
  - Add git remote URL extraction step before container clone

P1.193 Plan Mode PR Detection Logic ► ralph.ts:613-626, program.ts
  - Plan mode completion: PR exists + no unpushed commits = done
  - Effect implementation has no plan mode completion detection
  - After plan mode iteration, should check `gh pr view` and commit state
  - Different from build mode (feature-based completion)

New P2 Items (Jan 2026 - Iteration 15):
P2.62 Dashboard State Missing Fields ► DashboardLive.ts:38-50, types.ts:10-22
  - DashboardState interface has: iteration, maxIterations, features, promptTemplate
  - createStateEvent() helper only sends subset of fields
  - Clients receive incomplete state on connect
  - Add all DashboardState fields to state events

P2.63 Client Lifecycle Management ► DashboardLive.ts:118-164, specs/dashboard.md:257-280
  - SSE clients tracked in Set but no graceful cleanup on disconnect
  - Server shutdown doesn't properly close client connections
  - Add timeout detection for stale clients
  - Implement graceful shutdown sequence

P2.64 Duplicate Dashboard Implementations ► server.ts vs DashboardLive.ts
  - server.ts: 300 lines, full implementation with all endpoints
  - DashboardLive.ts: 200 lines, partial Effect-based implementation
  - Both maintain separate state management
  - Consolidate to single source of truth (prefer Effect-based)

New P3 Items (Jan 2026 - Iteration 15):
P3.29 JSONL Persistence System ► specs/logging-telemetry.md:59-78
  - Events should persist to `.ralph/sessions/{session-id}.jsonl`
  - Enables browser reconnection and history browsing
  - No file I/O for session logs anywhere in Effect implementation
  - Prerequisite for /logs/:iteration endpoint

P3.30 Iteration Boundary Markers ► specs/logging-telemetry.md:73-77
  - JSONL should contain iteration boundary events
  - Format: `{"type":"iteration_boundary","iteration":N,"timestamp":"..."}`
  - Allows efficient seeking to specific iteration in log file
  - Part of LoggingService implementation (P3.28)

New P4 Items (Jan 2026 - Iteration 15):
P4.30 mapError Boilerplate Reduction ► layers/*.ts (35 occurrences)
  - Same `.pipe(Effect.mapError((e) => new SomeError({...})))` pattern repeated 35x
  - Consider: helper function for common error mapping patterns
  - Or: use Effect.catchAll at layer boundaries instead of per-operation
  - Low priority but improves maintainability

P4.31 Dashboard Path from Config ► DashboardLive.ts:168, ConfigService
  - Dashboard static file path hardcoded in start() method
  - Users can't configure custom dashboard build path
  - Add dashboardPath to ConfigService and CLI args

New P5 Items (Jan 2026 - Iteration 15):
P5.47 Test: NDJSON parseNDJSONWithFallback ► ndjson.ts:41-60
  - Discriminated union return type (json vs text)
  - Mixed JSON/text stream handling
  - No dedicated tests despite complex logic

P5.48 Test: NDJSON fromReadableStream ► ndjson.ts:68-79
  - Converts ReadableStream<Uint8Array> to Stream<string>
  - Text decoding and chunking logic
  - Used by ClaudeLive for output streaming

P5.49 Test: NDJSON collectAll ► ndjson.ts:86-89
  - Collects stream to array
  - Simple but untested

P5.50 Test: NDJSON forEach ► ndjson.ts:97-101
  - Side-effect iteration over stream
  - Callback invocation semantics untested

P5.51 Test: main.ts Entry Point ► main.ts:26-68
  - CLI argument parsing integration
  - Layer composition with MainLive
  - Error handling via catchAll
  - Currently placeholder but should have test structure

New P6 Items (Jan 2026 - Iteration 15):
P6.46 Console.log vs Effect Console Inconsistency ► server.ts, ralph.ts
  - server.ts:299 uses direct console.log
  - ralph.ts has 100+ console.log calls
  - Effect code uses Console.error from Effect
  - No structured logging layer for log level control

P6.47 Empty Catch Blocks Swallow Errors ► server.ts:35-38, DashboardLive.ts:29-34
  - `catch { clients.delete(client) }` - error info lost
  - `catch { /* Client disconnected */ }` - no logging
  - Consider at minimum logging errors before handling
  - Helps debug production issues

P6.48 .nothrow() Pattern in Legacy Code ► ralph.ts (5 occurrences)
  - `.quiet().nothrow()` suppresses command output AND errors
  - Used for: cleanup, PR ready, git push
  - Error context lost, harder to debug failures
  - Effect equivalent should preserve error info where possible

P6.49 Dual Implementation Maintenance Burden ► ralph.ts (640 lines) vs src/
  - Complete working orchestrator in ralph.ts (Bun-based)
  - Incomplete Effect-based rewrite in src/
  - Both must be maintained until migration complete
  - Risk: features added to one, forgotten in other

Iteration 15 Dependency Graph Additions:
P1.186 Firewall Health ───────────────► P1.2 Firewall Ready Detection (extends)
P1.187 CI Verification ───────────────► Spec enforcement (new concern)
P1.188 AbortController ───────────────► P1.5 Signal Handling, P1.16 Stop Button (blocks)
P1.189 Session Cost ──────────────────► P2.46 Token Data Extraction (extends)
P1.190 Error Classification ──────────► P1.58 Timeout Error Detection (broader audit)
P1.191 Exec User Flags ───────────────► P1.21 Container User Switching (same)
P1.192 Remote URL Clone ──────────────► P1.17 Remote URL Extraction (same)
P1.193 Plan Mode PR ──────────────────► P1.14 Plan Mode Completion (same)
P2.62 State Fields ───────────────────► P1.38 Dashboard Broadcast (blocks complete state)
P2.63 Client Lifecycle ───────────────► P2.18 Dashboard Disconnect (same)
P2.64 Duplicate Dashboard ────────────► Architecture consolidation
P3.29 JSONL Persistence ──────────────► P3.28 LoggingService (part of)
P3.30 Iteration Boundary ─────────────► P3.29 JSONL Persistence (requires)
P4.30 mapError Reduction ─────────────► Code quality (low priority)
P4.31 Dashboard Path Config ──────────► P4.28 Volume Mount Paths (similar)
P5.47-P5.50 NDJSON Tests ─────────────► P5.30-P5.33 (same, renumbered)
P5.51 main.ts Tests ──────────────────► P5.39 createSession tests (related)
P6.46 Console Inconsistency ──────────► P3.28 LoggingService (addressed by)
P6.47 Empty Catch Blocks ─────────────► P1.178 Silent Error Swallow (same)
P6.48 .nothrow() Pattern ─────────────► P1.83 Error-Tolerant Commands (Effect equivalent)
P6.49 Dual Implementation ────────────► Migration tracking (meta-item)

New P1 Items (Jan 2026 - Iteration 16):
P1.194 createSession() Test Coverage ► program.ts:23-200, program.test.ts
  - 200-line function completely untested
  - Handles entire session bootstrap: container creation, volumes, firewall wait
  - Git cloning, workspace setup, permission fixes, git configuration
  - Branch creation/checkout logic
  - Critical path - any bug here breaks all sessions
  - Need integration test with mocked DockerService

P1.195 ClaudeLive Timeout Test Coverage ► ClaudeLive.ts:51-66
  - TimeoutError mapping at line 53-58
  - Effect.timeout integration at line 51
  - Critical for preventing hung iterations
  - No tests verify timeout behavior actually works

P1.196 GitLive.hasUnpushedCommits Test Coverage ► GitLive.ts:77-110
  - Two-step git command execution (branch detection + log parsing)
  - Partial failure scenarios untested
  - Circuit breaker depends on this function working correctly
  - Edge case: remote branch doesn't exist

P1.197 DockerLive exec/execStream Test Coverage ► DockerLive.ts:206-243
  - exec() at line 206-219: Command execution used by all operations
  - execStream() at line 220-243: Streaming with TextDecoder
  - Zero test coverage for core Docker execution path
  - All Claude and Git operations depend on these

P1.198 DockerLive File Operations Test Coverage ► DockerLive.ts:244-288
  - readFile() at line 244-263: features.json reading
  - writeFile() at line 265-288: Stream-based stdin piping
  - Core to iteration logic (features.json access)
  - Large file streaming behavior untested

P1.199 ClaudeLive Event Streaming Test Coverage ► ClaudeLive.ts:69-134
  - NDJSON parsing integration
  - Stream timeout at line 118
  - Error mapping at line 120-131
  - Dashboard depends on event stream working correctly
  - No tests for partial stream, connection loss scenarios

P1.200 ConfigLive Environment Validation Tests ► ConfigLive.ts:30-67
  - CLAUDE_CODE_OAUTH_TOKEN validation at line 35-42
  - Git root detection at line 50
  - Startup failures should have explicit tests
  - Edge cases: invalid git repo, missing token

P1.201 getRemainingFeatures Malformed JSON ► container.ts:41-47
  - No test for malformed JSON handling
  - JSON.parse will throw, not handled gracefully
  - Should return FeatureError instead of uncaught exception

P1.202 parseNDJSON Chunked Input Edge Case ► ndjson.ts:11-38
  - No test for partial JSON across chunk boundaries
  - Stream may deliver split JSON lines
  - Could cause parse failures in production

P1.203 Docker Exec Exit Code Handling ► DockerLive.ts:206-219
  - Command.string only returns stdout
  - Non-zero exit codes not captured
  - Silent failures possible for commands that fail

New P2 Items (Jan 2026 - Iteration 16):
P2.65 GitLive Push Failure Handling ► GitLive.ts:58-75
  - Push rejection (conflicts, force-push needed) untested
  - Should return specific GitError for push failures
  - Currently may propagate generic error

P2.66 GitLive Checkout Failure Scenarios ► GitLive.ts:19-44
  - Branch doesn't exist, dirty working tree
  - Checkout failure scenarios not tested
  - May silently fail or throw wrong error type

P2.67 ClaudeLive Non-Zero Exit Code Handling ► ClaudeLive.ts:40-67
  - run() creates ClaudeError for exitCode !== 0
  - No test verifies this error handling path
  - Important for detecting Claude CLI failures

P2.68 Server.ts Mutable State Thread Safety ► server.ts:8-9
  - Global mutable state: `const state: DashboardState = {...}`
  - Spec requires Effect Ref for thread-safe updates
  - Race conditions possible with concurrent SSE clients
  - Should migrate to DashboardLive service

P2.69 Dashboard Server Endpoints Test Coverage ► server.ts:213-300
  - /events SSE endpoint at line 223-232
  - /pause, /resume at line 235-241
  - /step-mode at line 244-253
  - /stop at line 256-263
  - All endpoints untested

New P3 Items (Jan 2026 - Iteration 16):
P3.31 Iteration Sidebar UI Component ► specs/logging-telemetry.md:79-110
  - Spec requires iteration cards with metrics
  - Token count and context percentage per iteration
  - No IterationSidebar.tsx component exists in dashboard/

P3.32 Activity Log Syntax Highlighting ► specs/logging-telemetry.md:113-180
  - Tool calls should be expanded by default
  - Syntax highlighting for code blocks
  - Collapsible summaries
  - ActivityLog.tsx exists but lacks these features

P3.33 Subagent Tracking UI ► specs/logging-telemetry.md:183-230
  - Track Task tool invocations with timing
  - Display spinner during Task execution
  - No subagent tracking logic in dashboard

P3.34 Prompt Editing and Re-run ► specs/logging-telemetry.md:233-258
  - Edit prompt in dashboard UI
  - POST /rerun endpoint to restart with modified prompt
  - Neither endpoint nor UI exists

P3.35 State Recovery Endpoints ► specs/logging-telemetry.md:261-284
  - GET /iterations - list with metrics
  - GET /logs/:iteration - JSONL events for iteration
  - Neither endpoint exists in server.ts

New P4 Items (Jan 2026 - Iteration 16):
P4.32 generateContainerName Validation ► container.ts:19-25
  - No validation of sessionId format
  - Could produce invalid Docker container names
  - Add regex validation for safe container naming

P4.33 parseStaleContainers Partial Line ► container.ts:27-32
  - No test for partial line output from docker ps
  - May occur with buffered output
  - Edge case worth considering

New P5 Items (Jan 2026 - Iteration 16):
P5.52 Test: Stream Cancellation Resource Cleanup ► ndjson.ts, ClaudeLive.ts
  - Stream cancellation/cleanup not tested
  - Resource leaks possible if streams not properly closed
  - Backpressure handling untested

P5.53 Test: DockerLive Container Lifecycle ► DockerLive.ts:40-205
  - create() at line 40-98: Argument building, image/command
  - start() at line 100-113
  - remove() at line 115-135: Force flag
  - inspect() at line 137-205: Running state, status, ID parsing
  - Zero test coverage for container lifecycle

P5.54 Test: DashboardLive SSE Broadcasting ► DashboardLive.ts:23-59
  - broadcastToClients() at line 23-35: Client tracking, error handling
  - updateAndBroadcast() at line 54-59: State sync
  - No test coverage for SSE functionality

P5.55 Test: detectGitRoot Not In Git Repo ► ConfigLive.ts:14-25
  - Should return ConfigError when not in git repo
  - Currently untested edge case
  - Important for clear error messaging

New P6 Items (Jan 2026 - Iteration 16):
P6.50 Context.Tag Workaround Pattern ► ClaudeLive.ts:18-19, GitLive.ts:16-17, DashboardLive.ts:61-62
  - Three services use `as any` workaround for Context.Tag issue
  - Comments reference ralph-progress.txt effect-020 notes
  - Consider filing Effect issue or finding proper solution
  - Technical debt that may cause issues with Effect updates

P6.51 Test Mock Pattern: Effect.fail("not implemented") ► program.test.ts (12 occurrences)
  - execStream stdout/stderr and runWithEvents use Effect.fail
  - Inconsistent with how other mocks work (return values)
  - Could mask issues if these code paths are exercised
  - Consider making mocks more realistic

Iteration 16 Dependency Graph Additions:
P1.194 createSession Tests ───────────► P1.1 Main Entry Point (critical path)
P1.195 Timeout Tests ─────────────────► P1.57 One-Hour Safety Timeout (validates)
P1.196 hasUnpushedCommits Tests ──────► P1.19 Unpushed Detection (validates)
P1.197-P1.198 Docker Tests ───────────► All Docker operations (foundation)
P1.199 Event Streaming Tests ─────────► Dashboard integration (validates)
P1.200 ConfigLive Tests ──────────────► P1.6 Environment Validation (validates)
P1.201 Malformed JSON ────────────────► P1.52 getRemainingFeatures Error (extends)
P1.202 Chunked Input ─────────────────► Stream robustness (edge case)
P1.203 Exit Code Handling ────────────► P1.80 Docker Exec Exit Code (same)
P2.65-P2.67 Git/Claude Errors ────────► Error handling robustness
P2.68 Server Thread Safety ───────────► P2.64 Duplicate Dashboard (consolidation)
P2.69 Server Endpoint Tests ──────────► P3.35 State Recovery Endpoints (validates)
P3.31-P3.35 Dashboard Features ───────► specs/logging-telemetry.md compliance
P4.32-P4.33 Container Utilities ──────► Edge case handling
P5.52-P5.55 Test Coverage ────────────► Comprehensive testing goal
P6.50 Context.Tag Workaround ─────────► Technical debt
P6.51 Test Mock Pattern ──────────────► Test quality

---

New P1 Items (Jan 2026 - Iteration 17):

P1.204 Event Streaming Not Integrated with Orchestrator ► program.ts:241, ClaudeLive.ts:69-134
  - runWithEvents() method exists but never called by orchestration loop
  - program.ts:241 uses claude.run() instead of claude.runWithEvents()
  - Spec requires events forwarded to DashboardService.broadcast()
  - Dashboard receives NO real-time Claude events despite infrastructure existing
  - CRITICAL: Core real-time functionality completely unused

P1.205 Dashboard Integration Missing from mainLoop ► program.ts:283-335
  - mainLoop has no DashboardService calls anywhere
  - Required integration points per spec:
    - setClaudeRunning(true/false) before/after Claude run
    - Pause check: while (isPaused() && !isStopping())
    - updateFeatures() after parsing features.json
    - updateIteration() with current/max/remaining
  - Dashboard UI non-functional without this integration

P1.206 Step Mode Not Implemented ► program.ts:283-335, args.ts:24
  - args.step flag parsed but never used in mainLoop
  - Spec requires post-iteration pause in step mode
  - Should set paused=true via DashboardService after each iteration
  - Race condition handling needed: Promise.race([promptForAction(), waitForResume()])
  - Key development/debugging feature missing

P1.207 listByPrefix Implementation Bug ► DockerLive.ts:292-318, services/Docker.ts:120-123
  - Spec says "List containers matching prefix" for cleanupStaleContainers()
  - Current implementation lists FILES INSIDE a container, not containers
  - DockerLive.ts:296 runs: find /workspace -name 'prefix*' -type f
  - Should run: docker ps -a --filter name=${prefix} --format "{{.Names}}"
  - Blocks P1.9 startup cleanup functionality

P1.208 JSONL Log Persistence System Missing ► specs/logging-telemetry.md:49-53
  - No LoggingService implementation exists
  - Required files: src/services/Logging.ts, src/layers/LoggingLive.ts
  - File path: .ralph/sessions/{session-id}.jsonl
  - JSONL format with raw Claude events, one per line
  - Core persistence requirement for state recovery

P1.209 State Recovery on Reconnect Missing ► specs/logging-telemetry.md:260-284
  - Browser doesn't load historical iteration data from JSONL on reconnect
  - Only connects to /events SSE, no recovery logic
  - Need: GET /logs/:iteration endpoint, useSessionRecovery hook
  - Critical for dashboard reliability

P1.210 Timeout Configuration Mismatch ► ConfigLive.ts:60, program.ts:244
  - ConfigLive.ts:60 defaults to 5 minutes
  - Spec says default should be 10 minutes
  - program.ts:244 hardcodes 10 minutes, ignoring config value
  - Should use config.timeoutMs instead of hardcoded value

P1.211 SSH Mount Path Mismatch ► program.ts:37, entrypoint.sh:15
  - Spec and program.ts mount SSH to /root/.ssh
  - entrypoint.sh:15 checks /home/node/.ssh instead
  - SSH keys may not be found, breaking SSH-based git operations
  - Critical path mismatch

P1.212 git safe.directory Missing from entrypoint.sh ► specs/container.md:211
  - Spec requires git config --system safe.directory /workspace in entrypoint.sh
  - Currently missing from docker/entrypoint.sh
  - Compensated by program.ts:125 but spec says should be in entrypoint

P1.213 verify_command Never Executed ► specs/features.md:72-87, src/
  - Feature type has verify_command?: string
  - Spec describes it as bash command that exits 0 on success
  - NO code anywhere executes this command
  - All verification delegated to Claude via instructions
  - ZFC design but orchestrator completely blind to verification status

P1.214 Missing Control Endpoints in DashboardLive ► DashboardLive.ts:115-175
  - DashboardLive only implements /events (SSE) and static file serving
  - Missing POST endpoints: /pause, /resume, /step-mode, /stop, /prompt
  - server.ts:234-281 has these but DashboardLive Effect implementation doesn't
  - Two parallel implementations with different capabilities

New P2 Items (Jan 2026 - Iteration 17):

P2.70 ContentBlock tool_result Type Missing ► types.ts:95-102
  - Spec defines tool_result content block type
  - types.ts only includes text, tool_use, thinking
  - TypeScript won't recognize tool_result blocks from Claude stream
  - Type safety gap

P2.71 ClaudeResultEvent interrupted Subtype Missing ► types.ts:117
  - Spec: subtype: "success" | "error" | "interrupted"
  - Implementation: subtype: "success" | "error" (missing "interrupted")
  - Type safety gap when Claude interrupted by timeout

P2.72 mcp_servers Type Mismatch ► types.ts:86
  - Spec: mcp_servers: string[]
  - Implementation: mcp_servers: Record<string, unknown>[]
  - Could cause parsing errors if Claude outputs string array

P2.73 Iteration Boundary Markers Missing ► specs/logging-telemetry.md:72-76
  - No iteration_start events written to mark boundaries in JSONL
  - Need: iteration_start event type in types.ts
  - program.ts should emit at start of each iteration
  - Required for iteration-specific log retrieval

P2.74 IterationMetrics Type Missing ► specs/logging-telemetry.md:92-102
  - No type definition for iteration-level token usage and metrics
  - Spec requires: token counts, context percentage, duration
  - Needed for iteration sidebar display
  - ClaudeMessageEvent.message.usage exists but no aggregation

P2.75 ClaudeEventMessage Type Mismatch ► specs/dashboard.md:115-118, types.ts:132-135
  - Spec: type: "claude"
  - Implementation: type: "claude_event"
  - Functional mismatch between spec and code

P2.76 OutputEvent Data Structure Mismatch ► specs/dashboard.md:95-98, types.ts:38-44
  - Spec: data: string
  - Implementation: data: { text: string, timestamp: number }
  - Spec and implementation don't match

P2.77 FeaturesEvent Data Structure Mismatch ► specs/dashboard.md:110-113, types.ts:63-68
  - Spec: data: Feature[]
  - Implementation: data: { features: Feature[] }
  - Object wrapper vs bare array

P2.78 Missing Initial Events in DashboardLive ► DashboardLive.ts:135-140
  - DashboardLive only sends initial state event
  - server.ts:136-167 sends state, iteration, AND features
  - Incomplete initial state synchronization

P2.79 Error Type Duplication ► services/*.ts, errors/index.ts
  - Error types defined as interfaces in service files
  - AND as Data.TaggedError classes in errors/index.ts
  - Service interfaces: {_tag, message, cause?}
  - errors/index.ts: Data.TaggedError with richer fields
  - Creates type/runtime mismatch

P2.80 Feature State Transition Tracking Missing ► types.ts:3-8, 50
  - types.ts:50 FeatureEvent has status: "pending" | "working" | "passed"
  - types.ts:3-8 Feature only has boolean passes
  - No mechanism to mark feature as "working" during implementation

P2.81 Invalid JSON Error Handling Missing ► container.ts:42
  - Raw JSON.parse() with no try-catch
  - Spec requires explicit error exit for invalid features.json
  - JSON parse errors throw unhandled exceptions

P2.82 GitHub .packages IP Ranges Missing ► docker/init-firewall.sh:76
  - Spec requires .packages field for GitHub Packages
  - Implementation only whitelists .web, .api, .git
  - May break npm packages from GitHub Packages

New P3 Items (Jan 2026 - Iteration 17):

P3.36 *.githubusercontent.com Missing from Allowlist ► docker/init-firewall.sh:83-89
  - Spec lists as required domain for GitHub raw content
  - Not in RALPH_ALLOWED_DOMAINS array
  - Blocks raw file fetching from GitHub repos

P3.37 Prompt File Writing Not Implemented ► specs/claude-integration.md:28-32
  - Spec: Write complex prompts to .ralph-prompt.md
  - Current: Prompt passed directly as CLI argument
  - No writeFile for .ralph-prompt.md path anywhere

P3.38 Service Naming Inconsistency ► services/*.ts
  - Three patterns: IDockerService, ClaudeService (interface), service shadowing class
  - IDockerService, IConfigService use "I" prefix
  - ClaudeService, GitService, DashboardService shadow class name
  - Requires as any workarounds due to interface/class shadowing

P3.39 BunContext.layer Provided Inline ► DockerLive.ts (11 occurrences)
  - DockerLive provides BunContext.layer at every Command execution
  - Lines: 94, 111, 133, 156, 176, 196, 215, 229, 259, 286, 309
  - Should be layer dependency for testability
  - Couples implementation to Bun runtime

P3.40 Tool Calls Not Expanded by Default ► dashboard/src/components/ActivityLog.tsx:68-78
  - Spec: Tool calls should display expanded by default
  - Line 74: expanded: false for tool_use items
  - Simple toggle change needed

P3.41 Prompt Display at Iteration Start Missing ► specs/logging-telemetry.md:170-181
  - Spec: Prompt displayed at top of activity log with border
  - No prompt rendering in ActivityLog.tsx
  - Needed for context when viewing past iterations

P3.42 Features File Existence Validation Missing ► main.ts, program.ts
  - Effect implementation doesn't validate features.json exists before session
  - ralph.ts:373-377 has this check
  - New main.ts is placeholder, skips validation

P3.43 Firewall Ready Detection Uses Sleep ► program.ts:74-75
  - TODO comment: Implement proper log streaming to detect "Ralph Firewall Ready"
  - Currently hardcoded 3-second sleep
  - May be too short (firewall not ready) or too long (delay)

New P4 Items (Jan 2026 - Iteration 17):

P4.34 No Cost/Token Aggregation Logic ► specs/claude-integration.md:224
  - Spec: Aggregate costs across iterations for total session cost
  - Types exist (cost_usd, total_cost_usd) but no aggregation logic

P4.35 Syntax Highlighting Missing ► dashboard/, specs/logging-telemetry.md:126-137
  - Spec: Auto-detect language, use Prism.js or highlight.js
  - No syntax highlighting library integrated
  - Tool call content rendered as plain <pre>

P4.36 Subagent (Task Tool) Tracking Missing ► specs/logging-telemetry.md:183-230
  - No SubagentTracker interface or display
  - No spinner with elapsed time during Task execution
  - dashboard/src/components/SubagentIndicator.tsx missing

P4.37 Network Monitoring/Audit Logging Missing ► specs/networking.md:158-161
  - Spec: Auditability - all allowed destinations explicitly listed
  - No runtime monitoring of blocked/allowed connections
  - No iptables logging rules
  - Would help debug connectivity issues

P4.38 Error Display Formatting Incomplete ► ActivityLog.tsx:81-93
  - ClaudeResultEvent error subtype handled
  - But timeout and docker errors not displayed inline
  - UX improvement for error visibility

P4.39 Missing Layer Dependency Documentation ► services/*.ts
  - Layer composition dependencies not documented in service files
  - Must read layer implementation to understand dependencies
  - layers/index.ts:14-27 has comments but service files don't

P4.40 Test Layers Don't Use satisfies Pattern ► layers/test/*.ts
  - Production layers use satisfies for type verification
  - Test layers use as any without verification
  - Test mocks might not match actual service interfaces

New P5 Items (Jan 2026 - Iteration 17):

P5.56 Model Flag Not in Spec ► ClaudeLive.ts:27,76
  - --model claude-opus-4-5-20251101 hardcoded in implementation
  - Flag not documented in specs/claude-integration.md:17-24
  - Either document or make configurable

P5.57 Inconsistent ICMP Reject Type ► docker/init-firewall.sh:137
  - Spec: icmp-port-unreachable
  - Implementation: icmp-admin-prohibited
  - Both work but minor consistency issue

P5.58 FeatureEvent Never Broadcasted ► types.ts:46-52
  - FeatureEvent type defined but never emitted
  - Only "features" (bulk) events sent, no individual feature updates

P5.59 Terminal Component Unused ► dashboard/src/components/Terminal.tsx
  - Full xterm implementation exists (93 lines)
  - Never imported or used in App.tsx
  - App uses ActivityLog instead

P5.60 FeaturesFile Interface Not Exported ► types.ts
  - Spec defines interface FeaturesFile { features: Feature[] }
  - Code uses inline type { features: Feature[] } instead
  - Not functional gap but type organization issue

P5.61 ConfigTest Uses Different Factory ► layers/test/ConfigTest.ts:10
  - Uses ConfigService.of({...}) factory
  - Other test layers use Layer.succeed(Service, mock)
  - Inconsistent pattern

New P6 Items (Jan 2026 - Iteration 17):

P6.52 parseNDJSON vs parseNDJSONWithFallback ► ndjson.ts, specs/claude-integration.md:118
  - Spec: Invalid JSON lines skipped, stream continues
  - parseNDJSON fails stream on JSON parse error
  - Only parseNDJSONWithFallback skips - but not used for Claude events

P6.53 Dockerfile Uses cp Instead of ln -s ► docker/Dockerfile.base:48-57
  - Spec shows symlinking bun/claude binaries from /root
  - Implementation uses cp (copy)
  - Both work but spec doesn't match implementation

P6.54 Missing .claude and templates Volume Mount in Spec ► specs/container.md:68
  - program.ts:38-39 mounts ~/.claude and templates directories
  - Not mentioned in container creation spec section
  - Undocumented volume mounts

P6.55 Thinking Blocks Shown vs Hidden ► ActivityLog.tsx:51-59, specs/logging-telemetry.md:166-168
  - Spec: Thinking blocks hidden by default, no toggle needed
  - Implementation: Creates items with expanded:false (collapsed but visible)
  - Minor deviation - shows collapsed vs hidden entirely

Iteration 17 Dependency Graph Additions:
P1.204 Event Streaming ───────────────► Dashboard real-time functionality (CRITICAL)
P1.205 Dashboard mainLoop ────────────► P1.204 Event Streaming (requires)
P1.206 Step Mode ─────────────────────► P1.205 Dashboard mainLoop (requires)
P1.207 listByPrefix Bug ──────────────► P1.9 Startup Cleanup (blocks)
P1.208 JSONL Persistence ─────────────► P3.28 LoggingService (same, confirms P1)
P1.209 State Recovery ────────────────► P1.208 JSONL Persistence (requires)
P1.210 Timeout Config ────────────────► P1.57 One-Hour Timeout (related)
P1.211 SSH Mount Path ────────────────► P1.23 Git Config (blocks SSH operations)
P1.212 safe.directory ────────────────► P1.23 Git Config (related)
P1.213 verify_command ────────────────► ZFC compliance (intentional delegation)
P1.214 DashboardLive Endpoints ───────► P2.64 Duplicate Dashboard (consolidation)
P2.70-P2.72 Type Mismatches ──────────► Type safety improvements
P2.73-P2.74 Iteration Tracking ───────► P1.208 JSONL Persistence (requires)
P2.75-P2.78 Dashboard Event Types ────► Spec alignment
P2.79 Error Type Duplication ─────────► P6.50 Context.Tag Workaround (related)
P2.80 Feature State Tracking ─────────► Dashboard feature status display
P2.81 JSON Error Handling ────────────► P1.201 Malformed JSON (extends)
P2.82 GitHub .packages ───────────────► Network isolation completeness
P3.36-P3.43 Various ──────────────────► Robustness and UX improvements
P4.34-P4.40 Various ──────────────────► Polish and documentation
P5.56-P5.61 Various ──────────────────► Minor consistency issues
P6.52-P6.55 Various ──────────────────► Documentation and minor deviations

Summary (Iteration 17):
- 11 new P1 items (P1.204-P1.214) - Critical integration gaps
- 13 new P2 items (P2.70-P2.82) - Type safety and data integrity
- 8 new P3 items (P3.36-P3.43) - Robustness improvements
- 7 new P4 items (P4.34-P4.40) - Polish and documentation
- 6 new P5 items (P5.56-P5.61) - Minor consistency
- 4 new P6 items (P6.52-P6.55) - Informational
- Total new items: 49

Running totals:
- P1 items: 214 (was 203)
- P2 items: 82 (was 69)
- P3 items: 43 (was 35)
- P4 items: 40 (was 33)
- P5 items: 61 (was 55)
- P6 items: 55 (was 51)
- Grand total: 495 items (was 446)

---

## Iteration 18 Research Findings (Jan 2026)

### New P1 Items (Critical Integration Gaps)

P1.215 Per-Feature CI Verification Enforcement ► specs/orchestrator.md:103-124
  - Spec: Claude MUST run full CI suite after EVERY feature
  - Gap: Orchestrator relies entirely on prompt instructions, no enforcement
  - Risk: Features marked `passes: true` without CI actually passing
  - Missing: Validation that typecheck/test/build/verify_command ran and passed

P1.216 Final Verification Two-Pass Logic ► specs/orchestrator.md:125-138
  - Gap: `finalVerificationDone` flag tracking not implemented
  - Missing: First pass runs verification, second pass marks PR ready
  - Missing: Reset flag if Claude makes changes during final verification

P1.217 .packages GitHub IP Range ► specs/networking.md:61, docker/init-firewall.sh:76
  - Gap: init-firewall.sh only includes `.web + .api + .git`
  - Missing: `.packages` field for GitHub Packages registry
  - Fix: `jq -r '(.web + .api + .git + .packages)[]'`

P1.218 *.githubusercontent.com Domain Allowlist ► specs/networking.md:38
  - Gap: Not in RALPH_ALLOWED_DOMAINS array
  - Impact: Blocks raw file fetching from GitHub repos
  - Fix: Add domain resolution for githubusercontent.com subdomains

P1.219 tool_result ContentBlock Type Missing ► specs/claude-integration.md:73, types.ts:95-102
  - Gap: types.ts only includes text, tool_use, thinking
  - Missing: `| { type: "tool_result"; tool_use_id: string; content: string }`
  - Impact: TypeScript won't recognize tool_result blocks from Claude stream

P1.220 Layer.scoped Lifecycle Not Implemented ► specs/dashboard.md:151-163
  - Gap: DashboardLive.ts uses Layer.scoped but doesn't implement cleanup
  - Missing: Resource cleanup on scope end (close SSE connections, stop server)
  - Missing: Finalization block in scoped layer

P1.221 Raw JSONL Event Passthrough ► specs/logging-telemetry.md:61-69
  - Gap: No LoggingService implementation exists
  - Missing: Write Claude events to JSONL without modification
  - Missing: Append-only file operations for concurrent access safety

P1.222 iteration_start Event Type ► specs/logging-telemetry.md:72-77
  - Gap: types.ts doesn't define iteration_start event type
  - Missing: `{"type":"iteration_start","iteration":N,"timestamp":"..."}`
  - Purpose: Allows dashboard to load events for specific iteration

P1.223 Session File Naming Convention ► specs/logging-telemetry.md:63
  - Gap: No logging file creation logic exists
  - Missing: Path `.ralph/sessions/{containerName}.jsonl`
  - Missing: Directory creation before file write

P1.224 /logs/:iteration Endpoint ► specs/logging-telemetry.md:42, 282-284
  - Gap: server.ts doesn't implement this endpoint
  - Missing: Scan JSONL for iteration boundaries, return subset
  - Response: text/plain with raw JSONL content

P1.225 /iterations Endpoint ► specs/logging-telemetry.md:273-280
  - Gap: Not implemented in server.ts
  - Missing: Parse JSONL to extract iteration list and token counts
  - Response: `{ iterations: IterationMetrics[], currentIteration: number }`

P1.226 /rerun Endpoint for Prompt Editing ► specs/logging-telemetry.md:244-255
  - Gap: Not implemented
  - Missing: POST endpoint accepts modified prompt, starts new iteration
  - Behavior: Appends to current branch, doesn't create new branch

P1.227 IterationMetrics Type Definition ► specs/logging-telemetry.md:92-101
  - Gap: types.ts doesn't define IterationMetrics
  - Fields: iteration, status, inputTokens, outputTokens, totalTokens, contextPercent, duration
  - Calculation: `contextPercent = (totalTokens / 200000) * 100`

P1.228 Prompt Display at Iteration Start ► specs/logging-telemetry.md:170-180
  - Gap: Dashboard doesn't render prompt content
  - Missing: Extract prompt from iteration start, display in collapsible block
  - Format: Monospace with syntax highlighting

P1.229 server.ts Has No Tests ► src/server.ts:1-301
  - Gap: 301 lines of dashboard server code completely untested
  - Missing: Tests for broadcast, updateState, updateIteration, updateFeatures
  - Missing: Tests for SSE stream creation, HTTP endpoints, static file serving
  - Priority: HIGH - Critical for dashboard functionality

P1.230 createSession() Untested ► src/program.ts:23-200
  - Gap: Session initialization logic has no tests
  - Missing: Tests for container creation, git clone, firewall wait, git config
  - Note: mainLoop and runIteration are tested, but session setup is not

P1.231 Layer Implementations Untested ► src/layers/*Live.ts
  - Gap: DockerLive, ClaudeLive, GitLive, ConfigLive have no tests
  - Missing: Docker command building, Claude CLI args, git operations
  - Note: Test layers exist as mocks but don't test real implementations

P1.232 FeatureEvent Never Handled in Dashboard ► dashboard/src/App.tsx:26-44
  - Gap: handleEvent handles state, iteration, features, claude_event, output
  - Missing: FeatureEvent type with id and status fields not processed
  - Spec: dashboard.md:100-103 defines FeatureEvent interface

P1.233 useSSE Reconnection Bug ► dashboard/src/hooks/useSSE.ts:26-32
  - Gap: Error handler creates new EventSource but doesn't attach handlers
  - Bug: New EventSource at line 30 has no onmessage/onerror handlers
  - Impact: Reconnected instances won't process events

P1.234 useSSE Cleanup Memory Leak ► dashboard/src/hooks/useSSE.ts:29-36
  - Gap: Reconnection timeout not cleaned up on unmount
  - Bug: 1-second timeout fires after component unmounts
  - Fix: Store timeout in ref, clear in useEffect cleanup

### New P2 Items (Type Safety & Data Integrity)

P2.83 ClaudeResultEvent.subtype Missing "interrupted" ► types.ts:117
  - Spec: subtype is success | error | interrupted
  - Gap: Only success | error defined
  - Missing: "interrupted" for timeout/signal cases

P2.84 mcp_servers Type Inconsistency ► specs/claude-integration.md:48, types.ts:86
  - Spec: mcp_servers is string array
  - Implementation: Record<string, unknown>[]
  - Needs: Verify actual Claude output format and reconcile

P2.85 StateEvent Partial State ► specs/dashboard.md:90-93, types.ts:27-35
  - Gap: StateEvent.data only includes subset of DashboardState fields
  - Missing: iteration, maxIterations, features, promptTemplate

P2.86 FeaturesEvent Structure Mismatch ► specs/dashboard.md:111-113, types.ts:65
  - Spec: FeaturesEvent.data is Feature[]
  - Implementation: Wraps in { features: Feature[] }
  - Creates: Unnecessary data.features access pattern

P2.87 DashboardError Not in errors/index.ts ► services/Dashboard.ts:4-8
  - Gap: Service interface defines DashboardError
  - Missing: Data.TaggedError class in errors module
  - Impact: Can't use with Effect.catchTag pattern

P2.88 ValidationError Not Used ► errors/index.ts
  - Gap: Defined but never thrown anywhere
  - Should: Use for features.json validation, CLI arg validation

P2.89 Error Type Field Inconsistencies ► services/*.ts vs errors/index.ts
  - DockerError: interface has `message`, class has `command`
  - ClaudeError: interface has `message`, class has `exitCode`
  - GitError: interface has `message`, class has `operation`
  - TimeoutError: interface has `timeoutMs`, class has `durationMs`

P2.90 Dashboard Types Missing Backend Fields ► dashboard/src/types.ts:10-24
  - Gap: Frontend StateData doesn't match backend DashboardState
  - Missing: iteration, maxIterations, features, promptTemplate fields
  - Creates: Synchronization issues where backend exposes more state

P2.91 Control API Error Handling Missing ► dashboard/src/hooks/useSSE.ts:39-58
  - Gap: pause, resume, setStepMode, stop fetch calls have no error handling
  - Missing: try-catch, error state, user feedback mechanism

### New P3 Items (Robustness & Edge Cases)

P3.44 Firewall Self-Verification Incomplete ► docker/init-firewall.sh:143-164
  - Gap: Only tests GitHub and Anthropic domains
  - Missing: Verify registry.npmjs.org, sentry.io, statsig domains
  - Risk: Firewall may silently fail for some domains

P3.45 Firewall DNS Resolution Retry ► docker/init-firewall.sh:92-108
  - Gap: WARNING on DNS failure but continues
  - Missing: Retry logic for transient DNS failures
  - Consider: Fail hard for critical domains (api.anthropic.com)

P3.46 GitHub Meta API Validation ► docker/init-firewall.sh:55-76
  - Gap: Doesn't validate .packages field exists
  - Missing: Validate response is valid JSON before jq parse
  - Missing: Retry on API failure

P3.47 CIDR Range Validation ► docker/init-firewall.sh:69-76
  - Gap: Doesn't validate CIDR values are sensible
  - Risk: Overly broad ranges (0.0.0.0/0) could bypass firewall
  - Missing: Reject suspiciously large ranges

P3.48 iptables Rule Ordering Race ► docker/init-firewall.sh:39-137
  - Gap: Sets default DROP then adds ACCEPT rules
  - Risk: Brief window where all traffic blocked during init
  - Should: Set ACCEPT rules first, THEN set default DROP

P3.49 Docker DNS Rule Restoration Validation ► docker/init-firewall.sh:17-37
  - Gap: No validation that DNS restoration succeeded
  - Missing: Verify DNS resolution works after restoration

P3.50 ipset Destroy Error Handling ► docker/init-firewall.sh:27
  - Gap: `|| true` silently ignores all errors
  - Risk: If ipset in use, destroy fails, create fails

P3.51 Entrypoint SSH Key Type Detection ► docker/entrypoint.sh:22-28
  - Gap: Only handles id_rsa OR id_ed25519
  - Missing: Other key types (ecdsa, dsa)
  - Missing: Fallback to ssh-add -l detection

P3.52 Workspace Permission Fix Failure ► docker/entrypoint.sh:12
  - Gap: `|| true` silently ignores permission errors
  - Risk: Container starts but Claude can't write files
  - Should: Verify at least /workspace root is writable

P3.53 Git Config Conditional Inconsistency ► docker/entrypoint.sh:23-28
  - Gap: SSH conditional but credential helper unconditional
  - Should: Only configure credential helper if GITHUB_TOKEN exists

P3.54 Thinking Block Type Guidance ► types.ts:96, specs/logging-telemetry.md:166-168
  - Gap: types.ts includes thinking but no rendering guidance
  - Missing: Document that thinking blocks should not be rendered
  - Dashboard: Should filter out thinking content blocks

P3.55 JSON.parse Error in getRemainingFeatures ► container.ts:42
  - Gap: Raw JSON.parse without try-catch
  - Impact: Throws on invalid JSON instead of returning error
  - Should: Return Effect with ValidationError

### New P4 Items (Polish & Documentation)

P4.41 Model Hardcoded Undocumented ► ClaudeLive.ts:27, specs/claude-integration.md:17-24
  - Gap: --model claude-opus-4-5-20251101 not in spec flag list
  - Should: Document flag or make configurable

P4.42 Verbose Flag Unexplained ► specs/claude-integration.md:23
  - Gap: Spec doesn't explain what verbose output includes
  - Missing: Document additional logging behavior

P4.43 Prompt Size Limits Undocumented ► specs/claude-integration.md:26-33
  - Gap: No guidance on size threshold for file vs CLI
  - Missing: Document max command-line prompt size (shell ARG_MAX)

P4.44 Tool Capabilities Incomplete ► specs/claude-integration.md:176-189
  - Gap: "Claude can" list not exhaustive
  - Missing: MCP server tools if enabled
  - Missing: File size limits, command timeout limits

P4.45 Cost Tracking Format Unspecified ► specs/claude-integration.md:211-223
  - Gap: No specification of decimal precision
  - Missing: Currency format, total cost aggregation logic

P4.46 num_turns Metric Undefined ► specs/claude-integration.md:84
  - Gap: No definition of what constitutes a "turn"
  - Missing: Is it assistant+user pairs? Total messages?

P4.47 IterationProgress Component Missing ► dashboard/
  - Spec: dashboard.md:223 lists IterationProgress component
  - Gap: Currently hardcoded inline in App.tsx:62-64
  - Should: Extract to dedicated component

P4.48 Feature Description No Expansion ► dashboard/src/components/FeatureList.tsx:80-86
  - Gap: Descriptions truncated with ellipsis, no way to expand
  - Unlike: ActivityLog items can be clicked to expand

P4.49 verify_command Not Displayed ► FeatureList.tsx:7-38
  - Gap: Feature type has verify_command but UI only shows id/description
  - Missing: Show what verification command runs

P4.50 Scroll Button Covers Content ► ActivityLog.tsx:172-184, 447-458
  - Gap: position:absolute bottom:12px overlays last log item
  - Impact: Content unreadable until user scrolls

### New P5 Items (Consistency & Naming)

P5.62 ClaudeEventMessage vs claude_event Naming ► dashboard.md:115-119
  - Gap: Type named ClaudeEventMessage, event.type is claude_event
  - Should: Rename type or event.type for consistency

P5.63 DashboardEvent Union Formatting ► types.ts:70
  - Gap: All types on one line (hard to read)
  - Style: Should be multi-line union for clarity

P5.64 Feature Status vs Passes Inconsistency ► types.ts:50
  - Gap: Feature has passes:boolean, FeatureEvent has status:string
  - Inconsistency: Different representations of same concept

P5.65 Template File Naming Convention ► templates/
  - Gap: No naming convention documented
  - Files: ralph-instructions.md, ralph-plan-mode.md

P5.66 Unused Terminal Component ► dashboard/src/components/Terminal.tsx
  - Gap: 93-line xterm implementation never imported
  - Status: Dead code, CSS still loaded in main.tsx:3

### New P6 Items (Minor Deviations)

P6.56 parseNDJSONWithFallback Unused ► ndjson.ts:41-60
  - Gap: Exported but never called
  - Status: Available for future use, not a bug

P6.57 fromReadableStream Unused ► ndjson.ts:68-79
  - Gap: Converts WHATWG ReadableStream, never called

P6.58 collectAll Unused ► ndjson.ts:86-89
  - Gap: Collects stream to array, never called

P6.59 forEach Unused ► ndjson.ts:97-101
  - Gap: Consumes stream with callback, never called

P6.60 parseInt NaN Not Validated ► args.ts:36,43
  - Gap: parseInt can return NaN, not validated
  - Note: Test verifies NaN result but doesn't reject it

P6.61 No Connection Status Indicator ► dashboard/src/hooks/useSSE.ts
  - Gap: No visual feedback when SSE connection fails/reconnects

P6.62 No Loading State for Initial Connection ► dashboard/src/App.tsx
  - Gap: Renders empty state while SSE connecting
  - Shows: "No features loaded" for both loading and empty

P6.63 No Keyboard Shortcuts ► dashboard/
  - Gap: No shortcuts for pause, resume, stop
  - All: Interactions require mouse clicks

---

Iteration 18 Dependency Graph Additions:
P1.215 CI Verification ────────────► Trust/correctness of feature completion
P1.216 Final Verification ─────────► P1.4 finalVerificationDone (extends)
P1.217-218 Network Domains ────────► P2.82 GitHub .packages (extends)
P1.219 tool_result Type ───────────► Type safety for Claude stream parsing
P1.220-228 Logging/Telemetry ──────► New subsystem, no existing implementation
P1.229-231 Test Gaps ──────────────► Quality/reliability improvements
P1.232-234 Dashboard Bugs ─────────► SSE reconnection correctness
P2.83-91 Type Mismatches ──────────► Type safety improvements
P3.44-55 Robustness ───────────────► Firewall/entrypoint edge cases
P4.41-50 Polish ───────────────────► Documentation and UX
P5.62-66 Consistency ──────────────► Naming and code organization
P6.56-63 Minor ────────────────────► Unused code, informational

Summary (Iteration 18):
- 20 new P1 items (P1.215-P1.234) - Critical gaps
- 9 new P2 items (P2.83-P2.91) - Type safety
- 12 new P3 items (P3.44-P3.55) - Robustness
- 10 new P4 items (P4.41-P4.50) - Polish
- 5 new P5 items (P5.62-P5.66) - Consistency
- 8 new P6 items (P6.56-P6.63) - Minor
- Total new items: 64

---

## Iteration 19 Research Findings

### Research Areas
- ZFC Architecture Compliance Analysis
- Logging & Telemetry Spec vs Implementation
- Dashboard Spec Compliance Verification
- Features.json Processing Pipeline

### New P1 Items (Critical Gaps - Logging/Telemetry Subsystem)

P1.235 LoggingService Interface Missing ► specs/logging-telemetry.md:49-52, 335
  - Gap: No `src/services/Logging.ts` interface exists
  - Spec Requires: `appendEvent(event)`, `getIterationEvents()`, `getSessionPath()` methods
  - Dependency: Foundation for entire telemetry subsystem

P1.236 LoggingLive Layer Missing ► specs/logging-telemetry.md:336
  - Gap: No `src/layers/LoggingLive.ts` implementation
  - Required For: JSONL file persistence to `.ralph/sessions/{session-id}.jsonl`
  - Blocks: All persistence and recovery features

P1.237 Session JSONL Files Not Created ► specs/logging-telemetry.md:56, 63
  - Gap: No JSONL log files created in `.ralph/sessions/`
  - Impact: No persistent audit trail, no session replay capability
  - Spec Path: `.ralph/sessions/{session-id}.jsonl`

P1.238 Iteration Boundary Markers Missing ► specs/logging-telemetry.md:72-76, 304
  - Gap: No `iteration_start` events emitted
  - Spec Format: `{"type":"iteration_start","iteration":3,"timestamp":"..."}`
  - Required For: Delineating iterations in JSONL files

P1.239 /logs/:iteration Endpoint Missing ► specs/logging-telemetry.md:42, 282-284, 305
  - Gap: Server only has `/events` SSE endpoint
  - Required: HTTP endpoint to retrieve JSONL events for specific iteration
  - Blocks: Browser recovery and historical log viewing

P1.240 /iterations Endpoint Missing ► specs/logging-telemetry.md:273-279
  - Gap: No endpoint to return list of iterations with metrics
  - Required For: Iteration sidebar population
  - Response Format: Array of `{id, totalTokens, costUsd, status}`

P1.241 Browser Recovery from JSONL Missing ► specs/logging-telemetry.md:261-284, 306
  - Gap: Dashboard reconnect only recreates SSE, no JSONL loading
  - Location: dashboard/src/hooks/useSSE.ts:26-32
  - Should: Load iteration list and logs on reconnect

P1.242 IterationMetrics Type Missing ► specs/logging-telemetry.md:93-101, 339
  - Gap: No `IterationMetrics` interface in types.ts
  - Fields: `totalTokens`, `contextPercent`, `costUsd`, `duration_ms`
  - Note: Token data in events but no aggregation

P1.243 Iteration Sidebar Component Missing ► specs/logging-telemetry.md:81-88, 309
  - Gap: No `dashboard/src/components/IterationSidebar.tsx`
  - Currently: Features sidebar exists, no iteration navigation
  - Required: Show iteration cards with metrics, status indicators

P1.244 Subagent Tracking Missing ► specs/logging-telemetry.md:208-227, 322
  - Gap: No `SubagentTracker` interface or Task tool timing
  - Required: Track `tool_use` events with `name: "Task"`
  - Correlate: With `tool_result` events for duration calculation

P1.245 SubagentIndicator Component Missing ► specs/logging-telemetry.md:344
  - Gap: No `dashboard/src/components/SubagentIndicator.tsx`
  - Shows: Spinner with elapsed time during Task execution
  - Required For: Long-running subagent visibility

P1.246 /rerun Endpoint Missing ► specs/logging-telemetry.md:244-254, 328
  - Gap: Server has no `/rerun` POST endpoint
  - Allows: Re-run iteration with modified prompt
  - Creates: N+1 iteration with user-edited prompt

P1.247 useSessionRecovery Hook Missing ► specs/logging-telemetry.md:346
  - Gap: No `dashboard/src/hooks/useSessionRecovery.ts`
  - Purpose: Load iteration history on reconnect/refresh
  - Currently: Only `useSSE.ts` exists

P1.248 Features.json Schema Validation Missing ► src/container.ts:41-44
  - Gap: `getRemainingFeatures()` does no schema validation
  - Missing: Checks for required fields (id, description, passes)
  - Risk: Invalid JSON structure silently produces undefined values

P1.249 Features.json Required Fields Not Validated ► src/container.ts:42-43
  - Gap: No validation that `id`, `description`, `passes` fields exist
  - Missing: Type guards for `verify_command` optional field
  - Impact: Runtime errors on malformed features.json

### New P2 Items (Type Safety & Spec Compliance)

P2.92 ZFC Violation: Mode-Based Prompt Selection ► src/main.ts:33-35
  - Gap: Orchestrator selects prompt template based on mode flag
  - Spec Forbids: Ranking/selection based on heuristics (zfc-architecture.md:76-85)
  - Pattern: Semantic routing, not pure structural data flow
  - Risk: Establishes pattern of orchestrator making content decisions

P2.93 ZFC Anti-Pattern: Test Mock Keyword Matching ► src/layers/test/DockerTest.ts:28-40
  - Gap: Mock uses `includes()` to route responses by command content
  - Spec Forbids: Keyword-based routing (zfc-architecture.md:206-219)
  - Risk: Tests don't validate ZFC compliance, pattern could leak to prod

P2.94 Template Field Name Mismatch: verification vs verify_command ► templates/ralph-instructions.md:57,64
  - Gap: Template uses `verification`, spec uses `verify_command`
  - Spec Location: specs/features.md:72
  - Impact: Inconsistent naming between spec and Claude instructions

P2.95 Template References Undefined Schema Fields ► templates/ralph-instructions.md:56,63,65
  - Gap: Template references `acceptance`, `verification`, `steps` fields
  - Spec: features.md:6-19 only defines `id`, `description`, `passes`, `verify_command`
  - Impact: Claude instructions don't match spec schema

P2.96 passes Field Type Not Validated at Runtime ► src/container.ts:43
  - Gap: No check that `passes` is actually boolean before filtering
  - Risk: Undefined, null, or string values could pass filter incorrectly
  - Should: Add type guard validation

P2.97 Feature State Transition Not Tracked ► src/program.ts:237
  - Gap: No validation that `passes` changed from false to true
  - Missing: Track which feature Claude worked on in current iteration
  - Should: Detect if exactly ONE feature was updated

P2.98 FeatureEvent Type Defined But Unused ► src/types.ts:46-52, src/server.ts
  - Gap: `FeatureEvent` (single feature update) type exists but never sent
  - Current: Only `FeaturesEvent` (full list) used in practice
  - Should: Either use the type or remove it

P2.99 Client SSE Reconnection Ref Leak ► dashboard/src/hooks/useSSE.ts:30
  - Gap: EventSource ref reassignment doesn't update cleanup function reference
  - Pattern: `eventSourceRef.current = new EventSource(...)` inside error handler
  - Risk: Old EventSource may not be properly cleaned up on component unmount

### New P3 Items (Robustness & Edge Cases)

P3.56 No Exponential Backoff on SSE Reconnect ► dashboard/src/hooks/useSSE.ts:29
  - Gap: Fixed 1-second retry on connection error
  - Should: Implement exponential backoff (1s, 2s, 4s, ..., max 30s)
  - Prevents: Connection storm on sustained network issues

P3.57 Tool Calls Not Expanded By Default ► dashboard/src/components/ActivityLog.tsx:74
  - Gap: Tool use events created with `expanded: false`
  - Spec Requires: `expanded: true` for tool calls (logging-telemetry.md:115-124)
  - Impact: User must click to expand every tool call

P3.58 Thinking Blocks Should Be Hidden, Not Collapsed ► dashboard/src/components/ActivityLog.tsx:51-59,228-232
  - Gap: Thinking blocks rendered collapsed with toggle capability
  - Spec: "hidden by default. No toggle needed" (logging-telemetry.md:167-168)
  - Should: Filter out thinking content blocks entirely

P3.59 JSON.parse Exception Not Handled in getRemainingFeatures ► src/container.ts:42
  - Gap: Raw JSON.parse without try-catch
  - Risk: Throws unhandled exception on invalid JSON
  - Should: Return Effect with ValidationError

P3.60 Args Validation Enables Non-Compliant Semantic Routing ► src/args.ts:45-47, src/main.ts:33-35
  - Gap: Structural mode validation serves semantic prompt routing
  - Analysis: Validation compliant, but purpose is non-compliant routing
  - Creates: Implicit dependency between CLI parsing and semantic decisions

### New P4 Items (Polish & Documentation)

P4.51 Prompt Display at Iteration Start Missing ► specs/logging-telemetry.md:171-181, 318
  - Gap: No prompt rendering at top of activity log
  - Should: Display prompt sent to Claude when viewing iterations

P4.52 Syntax Highlighting Missing ► specs/logging-telemetry.md:126-138, 315
  - Gap: No Prism.js or highlight.js in dashboard/package.json
  - Currently: Monospace with color `#79c0ff`, no syntax-specific highlighting
  - Should: Add language-aware syntax highlighting for tool input/output

P4.53 Task Tool Prompt/Result Special Handling Missing ► specs/logging-telemetry.md:200-204, 324
  - Gap: Generic tool display for Task tool
  - Should: Special handling for Task tool's prompt parameter and extended duration
  - Show: Subagent prompt, spinner during execution, elapsed time

P4.54 Editable Prompt Textarea Missing ► specs/logging-telemetry.md:233-241, 327
  - Gap: No prompt editor UI in dashboard components
  - Required For: Prompt tuning and re-run with modifications

P4.55 ToolCall Component Should Be Extracted ► dashboard/src/components/ActivityLog.tsx:191-253
  - Gap: Tool call rendering exists inline in `LogItem` function
  - Spec: Should have dedicated `ToolCall.tsx` component (logging-telemetry.md:343)
  - Benefits: Reusability, testability, separation of concerns

P4.56 Cost Tracking Aggregation Missing ► dashboard/src/components/ActivityLog.tsx:91
  - Gap: Cost displayed only in result events, no cumulative tracking
  - Should: Show per-iteration cost aggregation and session total

### New P5 Items (Consistency & Naming)

P5.67 ZFC Boundary Issue: Mode Validation Coupled to Routing ► src/args.ts:45-47 → src/main.ts:33-35
  - Gap: Structural args validation directly enables semantic routing
  - Pattern: Validation is compliant, but serves non-compliant purpose
  - Consider: Refactor to decouple validation from routing logic

P5.68 Iteration Progress Not Extracted to Component ► dashboard/src/App.tsx:51-69
  - Gap: Iteration progress implemented inline in App.tsx
  - Spec: Lists IterationProgress as dedicated component (dashboard.md:223)
  - Should: Extract to `dashboard/src/components/IterationProgress.tsx`

### New P6 Items (Minor Deviations)

P6.64 Terminal Component CSS Still Loaded ► dashboard/src/main.tsx:3, dashboard/src/components/Terminal.tsx
  - Gap: 93-line xterm implementation never imported but CSS loads
  - Status: Extends P5.66 (Terminal component unused)
  - Should: Either use component or remove along with CSS import

P6.65 Table-Like Data Rendering Not Detected ► dashboard/src/components/ActivityLog.tsx:261-286
  - Gap: JSON formatting exists but no table detection/rendering
  - Spec Mentions: Structured data rendering (logging-telemetry.md:139-149)
  - Low Priority: Nice-to-have visual improvement

P6.66 ZFC Compliant Patterns Documented ► Multiple Files
  - Note: Several patterns are correctly ZFC-compliant:
  - Boolean filtering: src/container.ts:43 (`!f.passes`)
  - Length-based change detection: src/layers/GitLive.ts:109
  - Type-based error handling: src/layers/ClaudeLive.ts:54-59 (`_tag`)
  - Informational: Document as reference for future development

---

Iteration 19 Dependency Graph Additions:
P1.235-247 Logging/Telemetry ────────► Complete subsystem (extends P1.220-228)
  └─ P1.235-236 Service/Layer ───────► Foundation for all telemetry
  └─ P1.237-238 JSONL Persistence ───► Session storage and boundaries
  └─ P1.239-240 HTTP Endpoints ──────► API access to logs
  └─ P1.241 Browser Recovery ────────► Reconnection with state
  └─ P1.242-245 UI Components ───────► Dashboard iteration/subagent views
  └─ P1.246-247 Prompt Editing ──────► Re-run capability

P1.248-249 Features Validation ──────► Runtime safety for features.json
P2.92-93 ZFC Violations ─────────────► Architecture compliance
P2.94-95 Template/Spec Mismatch ─────► Documentation consistency
P2.96-99 Type Safety ────────────────► Runtime validation
P3.56-60 Robustness ─────────────────► Error handling and UX
P4.51-56 Polish ─────────────────────► Dashboard improvements
P5.67-68 Consistency ────────────────► Code organization
P6.64-66 Minor ──────────────────────► Cleanup and documentation

Summary (Iteration 19):
- 15 new P1 items (P1.235-P1.249) - Logging subsystem and validation
- 8 new P2 items (P2.92-P2.99) - ZFC compliance and type safety
- 5 new P3 items (P3.56-P3.60) - Robustness improvements
- 6 new P4 items (P4.51-P4.56) - Polish and UX
- 2 new P5 items (P5.67-P5.68) - Consistency
- 3 new P6 items (P6.64-P6.66) - Minor items
- Total new items: 39

Running totals:
- P1 items: 249 (was 234)
- P2 items: 99 (was 91)
- P3 items: 60 (was 55)
- P4 items: 56 (was 50)
- P5 items: 68 (was 66)
- P6 items: 66 (was 63)
- Grand total: 598 items (was 559)
```

---

## Iteration 20 Research (Jan 2026)

### New P2 Items (Architecture Issues)

P2.100 Vite Proxy Configuration Incomplete ► dashboard/vite.config.ts:10-15
  - Gap: Only proxies `/events`, `/pause`, `/resume`, `/prompt`
  - Missing: `/step-mode` used at useSSE.ts:48, `/stop` used at useSSE.ts:56
  - Impact: Dev mode (`bun run dev`) step-mode and stop buttons fail with 404
  - Fix: Add `/step-mode` and `/stop` to proxy configuration

P2.101 Dual Dashboard Implementations Not Integrated ► src/server.ts vs src/layers/DashboardLive.ts
  - Gap: Two separate dashboard implementations exist
  - server.ts: Mutable global state, standalone functions (lines 6-21)
  - DashboardLive.ts: Effect-based with Ref state management
  - Neither integrated with orchestrator (main.ts, program.ts)
  - Impact: Dashboard exists but disconnected from orchestration
  - Fix: Choose one implementation and wire to orchestrator

### New P3 Items (Robustness)

P3.61 Empty Catch Blocks Missing Error Context ► Multiple files
  - DashboardLive.ts:31 - "Client disconnected" no cleanup
  - server.ts:37-39 - Deletes client without logging
  - server.ts:205-209 - Assumes all errors mean "dashboard not built"
  - ndjson.ts:55-58 - Silent JSON parse failure
  - Impact: Debugging production issues difficult without error context
  - Fix: Add logging or more specific error handling

P3.62 SessionConfig Interface Has 8 Unused Properties ► src/container.ts:3-14 vs src/program.ts:23-200
  - Interface defines: gitRoot, branch, isResume, githubToken, claudeOAuthToken, gitAuthorName, gitAuthorEmail, sshDir, claudeDir, gitconfigPath
  - createSession only uses: branch, gitRoot, isResume
  - Tokens read from config.oauthToken/githubToken instead
  - Volume paths hardcoded at program.ts:37-39
  - Impact: Interface suggests features that don't exist
  - Fix: Either use properties or remove from interface

### New P5 Items (Consistency)

P5.69 Layer Composition Uses Mixed Patterns ► src/layers/index.ts:28-40
  - Uses Layer.mergeAll for first group (lines 33-36)
  - Then chained Layer.provideMerge (lines 38-39)
  - Not incorrect, but obscures dependency relationships
  - Fix: Standardize on consistent composition pattern

P5.70 Test Mocks Using `as any` Pattern ► program.test.ts, ClaudeTest.ts, GitTest.ts, DashboardTest.ts
  - 20+ instances of `as any` to work around Context.Tag interface
  - Comments reference "Context.Tag interface/class shadowing issue"
  - Consistent pattern but indicates possible type system workaround needed
  - Informational: Document workaround rationale

### New P6 Items (Minor)

P6.67 server.ts May Be Orphaned Code ► src/server.ts
  - Full dashboard implementation (299 lines) with mutable state
  - Not imported in main.ts or program.ts
  - May be older implementation before Effect migration
  - Investigate: Is this dead code or intentionally separate?

P6.68 parseStaleContainers/parseContainerRunning Only Used in Tests ► src/container.ts:27-36
  - Functions exist and tested but not used in production code
  - DockerLive.inspect() parses output directly at lines 137-205
  - Low priority: Either integrate utilities or document as test helpers

---

Iteration 20 Dependency Graph Additions:
P2.100-101 Dashboard Integration ────► Critical for real dashboard usage
  └─ P2.100 Vite Proxy ──────────────► Dev mode functionality
  └─ P2.101 Implementation Choice ───► Architecture decision needed

P3.61-62 Robustness ─────────────────► Error handling and interface clarity
P5.69-70 Consistency ────────────────► Code organization
P6.67-68 Minor ──────────────────────► Dead code investigation

Summary (Iteration 20):
- 2 new P2 items (P2.100-P2.101) - Dashboard integration issues
- 2 new P3 items (P3.61-P3.62) - Robustness improvements
- 2 new P5 items (P5.69-P5.70) - Consistency patterns
- 2 new P6 items (P6.67-P6.68) - Minor investigations
- Total new items: 8

Running totals:
- P1 items: 249 (unchanged)
- P2 items: 101 (was 99)
- P3 items: 62 (was 60)
- P4 items: 56 (unchanged)
- P5 items: 70 (was 68)
- P6 items: 68 (was 66)
- Grand total: 606 items (was 598)

---

## Iteration 21 Research (Jan 2026)

### New P2 Items (Type Safety & State Issues)

P2.102 Dashboard Type Definitions Diverge Between Server and Client ► src/types.ts vs dashboard/src/types.ts
  - Gap: Two separate type definitions that should be identical
  - Server `DashboardState` (src/types.ts:10-22): Has `iteration`, `maxIterations` fields
  - Client `StateData` (dashboard/src/types.ts:10-18): Excludes these fields, uses separate `IterationData`
  - Impact: Manual sync required, potential runtime mismatches
  - Fix: Create shared types package or generate client types from server

P2.103 StateEvent Missing Fields From DashboardState ► src/server.ts:50-63, src/types.ts:25-36
  - Gap: `broadcastState()` creates partial StateEvent with only 7 of 11 fields
  - Current: Sends paused, running, stepMode, stopping, claudeRunning, containerName, branch
  - Missing: iteration, maxIterations, features, promptTemplate
  - Impact: Dashboard can't display full state from state events
  - Fix: Either broadcast all fields or document which fields require separate events

P2.104 Mode Validation Silently Ignores Invalid Values ► src/args.ts:45-47
  - Gap: Invalid mode values are silently ignored, defaults to "build"
  - Current: `if (["plan", "build"].includes(nextArg))` with no else clause
  - Impact: User typos go undetected, wrong mode runs silently
  - Fix: Add warning or error for invalid mode values

### New P3 Items (Robustness)

P3.63 SSE Heartbeat Missing - Proxy Timeout Risk ► src/server.ts:128-173, src/layers/DashboardLive.ts:111-179
  - Gap: No periodic SSE heartbeat to keep connection alive
  - Current: Only sends events when state changes
  - Impact: Long idle periods trigger proxy timeouts (typically 60s)
  - Fix: Send `:ping` comment every 30 seconds to keep connection alive

P3.64 SSE Reconnect Doesn't Re-Initialize State ► dashboard/src/hooks/useSSE.ts:26-32
  - Gap: Error handler reconnects EventSource but doesn't request current state
  - Current: Creates new EventSource in timeout, waits for next event
  - Impact: Dashboard shows stale state after network hiccup until server event arrives
  - Fix: Request /state endpoint on reconnect or have server send full state on new connection

P3.65 Claude Events May Arrive Before Dashboard Ready ► src/program.ts:241-251
  - Gap: mainLoop starts Claude before dashboard SSE clients may connect
  - Current: No check if dashboard is ready before broadcasting events
  - Impact: First few Claude events in iteration may be lost
  - Fix: Buffer events until first client connects, or accept loss as expected behavior

P3.66 Dashboard Build Not Validated Before Server Start ► src/server.ts:188-210
  - Gap: Server starts successfully but dashboard 404s if not built
  - Current: Returns 404 with "Run bun run build" message at line 206
  - Impact: Confusing UX - server starts but dashboard shows error
  - Fix: Check if dist directory exists in startDashboardServer() and warn/fail

### New P4 Items (Polish)

P4.57 No React Error Boundary in Dashboard ► dashboard/src/App.tsx
  - Gap: No error boundary component, uncaught errors crash entire UI
  - Current: No componentDidCatch or ErrorBoundary anywhere in dashboard/
  - Impact: Parse errors, null references, or runtime exceptions show white screen
  - Fix: Add error boundary wrapper with "Something went wrong" fallback UI

P4.58 ActivityLog Ref Race Condition ► dashboard/src/App.tsx:9,38
  - Gap: ActivityLog ref can be null when events arrive early
  - Current: Uses optional chaining `activityLogRef.current?.addEvent(event.data)`
  - Impact: Events arriving before component mount are silently dropped
  - Fix: Queue events until ref is attached, or accept as expected startup behavior

### New P5 Items (Consistency)

P5.71 Placeholder State Uses Wrong Branch Value ► src/main.ts:38-50
  - Gap: Placeholder state has hardcoded `branch: "main"` instead of actual branch
  - Current: `args.branch` parsed at line 27 but not used in placeholder at line 45
  - Impact: Dashboard shows "main" instead of actual branch during development
  - Fix: Use `args.branch ?? "main"` in placeholder state

P5.72 DashboardPath Not in ConfigService ► src/services/Config.ts:4-16
  - Gap: DashboardLive.start() requires dashboardPath but ConfigService doesn't provide it
  - Current: No dashboardPath field in ConfigService interface
  - Impact: Production has no way to configure dashboard dist path
  - Fix: Add dashboardPath to ConfigService with default based on RALPH_HOME

---

Iteration 21 Dependency Graph Additions:
P2.102-104 Type Safety ─────────────► State synchronization and validation
  └─ P2.102 Type Divergence ────────► Single source of truth needed
  └─ P2.103 StateEvent Partial ─────► Dashboard state completeness
  └─ P2.104 Mode Validation ────────► User input handling

P3.63-66 Robustness ────────────────► Connection stability and startup
  └─ P3.63 SSE Heartbeat ───────────► P3.56 SSE Reconnect (complements)
  └─ P3.64 Reconnect State ─────────► P3.63 SSE Heartbeat (requires)
  └─ P3.65 Event Timing ────────────► Dashboard integration
  └─ P3.66 Build Validation ────────► Server startup

P4.57-58 Polish ────────────────────► UI robustness
P5.71-72 Consistency ───────────────► Configuration patterns

Summary (Iteration 21):
- 3 new P2 items (P2.102-P2.104) - Type safety and state issues
- 4 new P3 items (P3.63-P3.66) - Robustness improvements
- 2 new P4 items (P4.57-P4.58) - Polish items
- 2 new P5 items (P5.71-P5.72) - Consistency patterns
- Total new items: 11

Running totals:
- P1 items: 249 (unchanged)
- P2 items: 104 (was 101)
- P3 items: 66 (was 62)
- P4 items: 58 (was 56)
- P5 items: 72 (was 70)
- P6 items: 68 (unchanged)
- Grand total: 617 items (was 606)

---

## Iteration 22 Research (Jan 2026)

### Research Focus Areas
1. Test coverage and implementation quality analysis
2. Docker/container implementation vs spec gaps
3. Effect.js patterns and potential issues
4. Dashboard spec compliance verification
5. Features.json processing pipeline validation

### New P1 Items (Critical Gaps)

P1.250 SSH Volume Mount Path Mismatch ► src/program.ts:37, docker/entrypoint.sh:15, ralph.ts:167
  - Gap: Three conflicting SSH mount paths in codebase
  - program.ts:37 mounts to `/root/.ssh`
  - ralph.ts:167 (working) mounts to `/home/node/.ssh`
  - entrypoint.sh:15 expects `/home/node/.ssh`
  - Impact: Git authentication breaks in Effect implementation
  - Fix: Use `/home/node/.ssh` consistently (node user runs as UID 1000)

P1.251 listByPrefix Wrong Implementation ► src/layers/DockerLive.ts:292-318, src/services/Docker.ts:120-123
  - Gap: Method lists FILES inside container, not CONTAINERS on host
  - Signature: `(containerName, prefix)` should be just `(prefix)`
  - Implementation uses `find /workspace` instead of `docker ps --filter`
  - Impact: cleanupStaleContainers() cannot find orphaned containers
  - Fix: Reimplement to query Docker host for containers matching prefix

P1.252 Claude Volume Read-Only Breaks Writes ► src/program.ts:38
  - Gap: Claude config mounted as `:ro` but Claude CLI may write to it
  - Working code (ralph.ts:168) uses `:rw`
  - Impact: Claude Code may fail when writing to config/plugins/cache
  - Fix: Change to `:rw` to match working implementation

P1.253 Templates Path Uses Wrong Base ► src/program.ts:39
  - Gap: Uses `process.cwd()` instead of script directory
  - Working code (ralph.ts:72) uses `import.meta.dir` for RALPH_HOME
  - Impact: Template mount fails when invoked from different directory
  - Fix: Use `import.meta.dir` or resolve path relative to script

P1.254 Missing .gitconfig Volume Mount ► src/program.ts:36-40
  - Gap: New implementation doesn't mount host `.gitconfig`
  - Working code (ralph.ts:169) includes `-v ~/.gitconfig:/home/node/.gitconfig:ro`
  - Impact: Git operations may use wrong author or config
  - Fix: Add gitconfig volume mount to program.ts

P1.255 Missing GIT_AUTHOR Environment Variables ► src/program.ts:41-44
  - Gap: Missing `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `ANTHROPIC_API_KEY`
  - Working code (ralph.ts:170-174) passes all three
  - Impact: Git commits have wrong/missing author information
  - Fix: Add environment variables from config or env

P1.256 getRemainingFeatures Throws on Invalid JSON ► src/container.ts:41-44
  - Gap: `JSON.parse()` without try/catch
  - Returns Effect type but throws synchronous exception
  - Impact: Malformed features.json crashes orchestrator
  - Fix: Wrap in Effect.try() and return ValidationError

P1.257 No .features Property Validation ► src/container.ts:42
  - Gap: Accesses `parsed.features` without checking existence
  - Impact: TypeError if JSON lacks features array
  - Fix: Validate structure before accessing .features

P1.258 No Feature Field Type Validation ► src/container.ts:43
  - Gap: Filter assumes `passes` is boolean
  - String "false" is truthy, causes incorrect filtering
  - Impact: Features with wrong types get filtered incorrectly
  - Fix: Add type guard for passes field

P1.259 Stream Scoping Issue in ClaudeLive ► src/layers/ClaudeLive.ts:69-134
  - Gap: `Stream.unwrap` on scoped `execStream` may close scope prematurely
  - docker.execStream returns Effect.scoped at DockerLive.ts:220
  - Unwrapping doesn't maintain scope lifecycle
  - Impact: Stream may fail or hang when underlying process scope closes
  - Fix: Restructure to keep scope open while stream is consumed

P1.260 No Cleanup Finally Block in main.ts ► src/main.ts:52-68
  - Gap: No Effect.ensuring or finally block for container cleanup
  - Spec requires cleanup in finally (orchestrator.md:48-50)
  - Impact: Crashed/interrupted runs leave orphaned containers
  - Fix: Add Effect.ensuring to remove container on any exit

P1.261 Generic Error Handler Loses Type Info ► src/main.ts:64-67
  - Gap: `Effect.catchAll` converts all errors to string
  - No specific handling for ConfigError vs DockerError vs TimeoutError
  - Impact: Cannot differentiate recoverable from fatal errors
  - Fix: Use catchTags for specific error type handling

P1.262 CircuitBreakerError Not Caught ► src/program.ts:325-330, src/main.ts
  - Gap: Effect.fail(CircuitBreakerError) has no catchTag handler
  - Error propagates to generic catchAll
  - Impact: Circuit breaker exit indistinguishable from other failures
  - Fix: Add specific catchTag for graceful circuit breaker exit

P1.263 Effect.runSync Without Error Handling ► src/layers/DashboardLive.ts:127,136,145
  - Gap: Three runSync calls in ReadableStream callbacks with no error handling
  - Effect.runSync throws if effect fails
  - Impact: Ref operation failure crashes SSE stream
  - Fix: Wrap in try-catch or use Effect.runSyncExit

P1.264 No Retry Logic Anywhere ► Multiple files
  - Gap: No Effect.retry or Stream.retry in entire codebase
  - Spec classifies DockerError as recoverable (orchestrator.md:232)
  - Impact: Transient failures cause immediate orchestrator exit
  - Fix: Add retry with backoff for recoverable errors

P1.265 Test Coverage Only 30-40% ► Multiple test files
  - Gap: 1,263 lines of tests for ~3,000+ lines of implementation
  - 0% coverage for: DockerLive, ClaudeLive, GitLive, ConfigLive, DashboardLive
  - 0% coverage for: main.ts, server.ts, createSession()
  - 0% coverage for: All dashboard frontend (React components)
  - Impact: Refactoring/changes may break untested code paths
  - Fix: Add integration tests for live layers, unit tests for critical paths

### New P2 Items (Architecture & Type Safety)

P2.105 Dual Server Implementation Confusion ► src/server.ts, src/layers/DashboardLive.ts
  - Gap: Two complete dashboard server implementations exist
  - server.ts: 301 lines with mutable global state
  - DashboardLive.ts: 217 lines with Effect Ref state
  - Neither integrated with orchestrator (main.ts, program.ts)
  - Impact: Unclear which to use, potential maintenance burden
  - Fix: Choose one implementation, remove or deprecate other

P2.106 State Management Split ► src/server.ts:9, src/layers/DashboardLive.ts:14
  - Gap: server.ts uses mutable global `state` object
  - DashboardLive.ts uses Effect `Ref` for state
  - Both implement separate broadcast logic
  - Impact: State synchronization issues if both used
  - Fix: Consolidate to single state management approach

P2.107 Missing FeatureEvent Handler ► dashboard/src/App.tsx:26-44
  - Gap: Client handles `state`, `iteration`, `features`, `claude_event`, `output`
  - Does not handle `feature` (individual feature updates)
  - Type defined in src/types.ts:46-52 but never used
  - Impact: Individual feature updates not reflected in UI
  - Fix: Add handler or remove unused type

P2.108 Tool Calls Collapsed by Default ► dashboard/src/components/ActivityLog.tsx:74
  - Gap: Tool use events created with `expanded: false`
  - Spec requires `expanded: true` (logging-telemetry.md:115-124)
  - Impact: User must click to expand every tool call
  - Fix: Change default to `expanded: true`

P2.109 execStream Scoped Effect Misuse ► src/layers/DockerLive.ts:220-243
  - Gap: Returns streams from Effect.scoped without ensuring scope lifecycle
  - When calling code consumes stream, scope may already be closed
  - Impact: Potential stream failures or process leaks
  - Fix: Document scope requirements or restructure pattern

P2.110 copyToContainer Uses Effect.die ► src/layers/DockerLive.ts:290
  - Gap: Unimplemented method uses `Effect.dieMessage`
  - Service interface declares `Effect<void, DockerError>` at Docker.ts:111
  - Effect.die is unrecoverable defect, not typed error
  - Impact: Any call to copyToContainer crashes process
  - Fix: Return Effect.fail(DockerError) or implement method

P2.111 Redundant Git Configuration in Session ► src/program.ts:120-167, docker/entrypoint.sh:23-33
  - Gap: Both orchestrator and entrypoint configure git
  - Entrypoint dynamically detects key type (rsa vs ed25519)
  - Orchestrator hardcodes id_rsa path
  - Impact: Orchestrator may override correct entrypoint config
  - Fix: Let entrypoint handle all git config, remove from orchestrator

### New P3 Items (Robustness)

P3.67 No Feature ID Uniqueness Validation ► src/container.ts
  - Gap: Duplicate feature IDs never detected
  - Multiple features with same ID cause ambiguous state
  - Impact: Commit messages, progress tracking become unclear
  - Fix: Validate ID uniqueness before processing

P3.68 No Backward Transition Detection ► src/program.ts:237
  - Gap: Nothing prevents `passes: true → false` transitions
  - Could indicate regression or Claude error
  - Impact: Silent feature regression goes unnoticed
  - Fix: Warn or error if completed feature becomes incomplete

P3.69 verify_command Never Executed by Orchestrator ► src/container.ts, src/program.ts
  - Gap: Orchestrator trusts Claude to run verification
  - No independent verification by orchestrator
  - Impact: Claude can skip verification, mark features complete incorrectly
  - Fix: Optional orchestrator-side verification after Claude marks complete

P3.70 Silent JSON Parse Error in Dashboard ► ralph.ts:474-480
  - Gap: Parse errors caught and silently ignored
  - Dashboard shows stale data without notification
  - Impact: User unaware of features.json corruption
  - Fix: Log warning or show error state in dashboard

P3.71 Empty Features Array Ambiguity ► src/container.ts:41-44
  - Gap: No distinction between "no features defined" vs "all complete"
  - Both return empty array
  - Impact: Confusing exit conditions
  - Fix: Return discriminated union or add metadata

P3.72 Missing Test Coverage for Live Layers ► src/layers/*.ts
  - Gap: 0% test coverage for DockerLive (325 lines), ClaudeLive (138 lines),
    GitLive (141 lines), ConfigLive (68 lines), DashboardLive (217 lines)
  - Tests only cover mocked behavior
  - Impact: Bugs in actual Docker/Git/Claude integration undetected
  - Fix: Add integration tests with real Docker commands

P3.73 No Test Coverage for Server or Dashboard ► src/server.ts, dashboard/src/
  - Gap: 0% test coverage for server (301 lines) and all React components
  - Impact: UI bugs, SSE issues, endpoint errors go undetected
  - Fix: Add server endpoint tests and React component tests

P3.74 parseNDJSONWithFallback Not Tested ► src/streams/ndjson.ts:41-60
  - Gap: Function exists but no test coverage
  - Also untested: fromReadableStream, collectAll, forEach
  - Impact: Stream utility bugs may cause silent failures
  - Fix: Add tests for all stream utility functions

### New P4 Items (Polish)

P4.59 No Syntax Highlighting in Tool Calls ► dashboard/src/components/ActivityLog.tsx:236
  - Gap: Code displayed in `<pre>` with monospace styling only
  - Spec mentions Prism.js or highlight.js (logging-telemetry.md:126-138)
  - Impact: Reduced readability of code in tool output
  - Fix: Add syntax highlighting library and language detection

P4.60 No Loading States in Dashboard ► dashboard/src/App.tsx
  - Gap: No loading indicators during SSE connection
  - No skeleton screens, no loading state for control actions
  - Impact: State transitions appear instant without feedback
  - Fix: Add loading states for async operations

P4.61 No Error Feedback in Dashboard UI ► dashboard/src/hooks/useSSE.ts:21-24
  - Gap: JSON parse errors silently ignored
  - Reconnection happens without user notification
  - Control actions have no error handling
  - Impact: Users unaware of connection errors or failed actions
  - Fix: Add error toast/notification system

P4.62 Missing ARIA Labels for Accessibility ► dashboard/src/
  - Gap: No ARIA labels anywhere in dashboard components
  - No role attributes, missing keyboard navigation
  - Expandable items lack Enter/Space support
  - Impact: Screen reader users cannot navigate dashboard
  - Fix: Add ARIA labels, roles, and keyboard event handlers

P4.63 Fixed Sidebar Width Not Responsive ► dashboard/src/App.tsx:155
  - Gap: Sidebar fixed at 320px width
  - No media queries, no mobile layouts
  - Impact: Layout breaks on narrow screens (<768px)
  - Fix: Add responsive breakpoints and collapsible sidebar

### New P5 Items (Consistency)

P5.73 Test Mocks Use `as any` Workaround ► src/layers/test/*.ts
  - Gap: 20+ instances of `as any` to work around Context.Tag interface
  - Comments reference "Context.Tag interface/class shadowing issue"
  - Impact: Type safety reduced in test code
  - Note: Consistent pattern, may need Effect-specific solution

P5.74 Layer Composition Uses Mixed Patterns ► src/layers/index.ts:28-40
  - Gap: Uses Layer.mergeAll then chained Layer.provideMerge
  - Not incorrect but obscures dependency relationships
  - Impact: Harder to understand layer dependencies
  - Fix: Standardize on consistent composition pattern

P5.75 server.ts May Be Orphaned Code ► src/server.ts
  - Gap: Full 299-line implementation not imported anywhere
  - May be older pre-Effect implementation
  - Impact: Maintenance burden if not used
  - Investigate: Determine if dead code or intentionally separate

### New P6 Items (Minor)

P6.69 parseStaleContainers/parseContainerRunning Only in Tests ► src/container.ts:27-36
  - Gap: Functions exist and tested but not used in production
  - DockerLive.inspect() parses output directly
  - Status: Low priority - either integrate or document as test helpers

P6.70 Terminal Component CSS Still Loaded ► dashboard/src/main.tsx:3
  - Gap: 93-line xterm Terminal component never imported but CSS loads
  - Extends P5.66 (Terminal component unused)
  - Impact: Unnecessary CSS bundle size
  - Fix: Remove component and CSS import if truly unused

---

Iteration 22 Dependency Graph Additions:
P1.250-255 Container Setup ──────────► Critical path for basic operation
  └─ P1.250 SSH Mount Path ──────────► Git authentication
  └─ P1.251 listByPrefix ────────────► P1.9 Startup Cleanup
  └─ P1.252-254 Volume Issues ───────► Claude and template access
  └─ P1.255 Missing Env Vars ────────► P1.6 Env Validation

P1.256-258 Features Validation ──────► Runtime safety for features.json
  └─ P1.256 JSON Parse Safety ───────► P3.59 (extends)
  └─ P1.257-258 Schema Validation ───► P1.248-249 (extends)

P1.259-264 Effect Patterns ──────────► Correctness and robustness
  └─ P1.259 Stream Scoping ──────────► P2.109 (related)
  └─ P1.260 Cleanup ─────────────────► P1.11 (already flagged)
  └─ P1.261-262 Error Handling ──────► Main entry robustness
  └─ P1.263 Effect.runSync ──────────► DashboardLive safety
  └─ P1.264 Retry Logic ─────────────► All recovery scenarios

P1.265 Test Coverage ────────────────► Quality assurance
P2.105-111 Architecture ─────────────► Code organization and clarity
P3.67-74 Robustness ─────────────────► Error handling and edge cases
P4.59-63 Polish ─────────────────────► Dashboard improvements
P5.73-75 Consistency ────────────────► Code patterns
P6.69-70 Minor ──────────────────────► Cleanup items

Summary (Iteration 22):
- 16 new P1 items (P1.250-P1.265) - Container setup, validation, Effect patterns
- 7 new P2 items (P2.105-P2.111) - Architecture and type safety
- 8 new P3 items (P3.67-P3.74) - Robustness and test coverage
- 5 new P4 items (P4.59-P4.63) - Dashboard polish
- 3 new P5 items (P5.73-P5.75) - Consistency patterns
- 2 new P6 items (P6.69-P6.70) - Minor cleanup
- Total new items: 41

Running totals:
- P1 items: 265 (was 249)
- P2 items: 111 (was 104)
- P3 items: 74 (was 66)
- P4 items: 63 (was 58)
- P5 items: 75 (was 72)
- P6 items: 70 (was 68)
- Grand total: 658 items (was 617)

---

## Iteration 23 Research (Jan 2026)

### New P1 Items (Critical Gaps from Spec)

P1.266 Plan Mode Implementation ► src/program.ts, specs/orchestrator.md:175-176
  - Gap: --mode plan flag parsed but no distinct plan mode workflow implemented
  - Missing: Plan mode initialization, feature filtering, plan-specific PR creation
  - Spec requires different behavior for plan vs build mode
  - Impact: Plan mode produces incorrect results or fails silently
  - Fix: Implement PlanModeService or conditional logic in orchestration loop

P1.267 Firewall Functional Verification ► docker/init-firewall.sh, specs/networking.md:116-143
  - Gap: P1.2 detects "Ralph Firewall Ready" message but doesn't verify firewall works
  - Spec requires DNS test (npx), SSH test (git ls-remote), domain connectivity
  - Impact: Firewall may be "ready" but misconfigured, allowing Claude internet access
  - Fix: Run verification commands after detecting ready message, fail if tests fail

P1.268 MCP Servers Integration ► specs/claude-integration.md
  - Gap: Claude system events include mcp_servers field, not handled
  - Unknown behavior when MCP servers unavailable or fail to start
  - Impact: Claude may fail silently or behave unexpectedly
  - Fix: Document MCP handling or implement error detection for MCP failures

P1.269 Features.json Dependency Field ► specs/features.md:214-225
  - Gap: Spec shows features with dependency ordering
  - Feature interface lacks dependency field
  - No circular dependency detection
  - P1.47 validates schema but not dependencies
  - Impact: Features may run in wrong order, causing verification failures
  - Fix: Add dependencies array to Feature interface, implement topological sort

P1.270 Logging/Telemetry Service ► specs/logging-telemetry.md, src/services/
  - Gap: Spec defines .ralph/sessions/ directory structure and JSONL logging
  - No LoggingService implementation exists
  - DashboardLive.ts has no JSONL append functionality
  - Impact: No session history, no audit trail, no replay capability
  - Fix: Create LoggingService with JSONL file writing per session/iteration

P1.271 Session State Recovery Endpoints ► specs/logging-telemetry.md:260-284
  - Gap: Spec describes state recovery on reconnect
  - Missing /iterations and /logs/:iteration endpoints
  - No iteration metrics tracking or session persistence
  - Impact: Dashboard reconnect loses all history
  - Fix: Add iteration history endpoint, persist state to disk

P1.272 SSH Key Permissions Validation ► docker/entrypoint.sh
  - Gap: SSH key must have 600 permissions
  - No validation that mounted key has correct permissions
  - Impact: Git operations fail silently with "permissions too open" error
  - Fix: Add chmod 600 check or explicit chmod in entrypoint

P1.273 Environment Variable Injection Protection ► src/layers/ConfigLive.ts
  - Gap: GIT_AUTHOR_NAME, GITHUB_TOKEN passed to shell without sanitization
  - Could contain shell metacharacters enabling injection
  - Impact: Security vulnerability - arbitrary command execution
  - Fix: Validate/sanitize all env vars before shell interpolation

P1.274 Container Resource Limits ► src/layers/DockerLive.ts, specs/container.md
  - Gap: Spec defines capabilities but not memory/CPU limits
  - No --memory, --cpus flags in docker create
  - Impact: Runaway containers exhaust host resources
  - Fix: Add configurable resource limits (--memory=4g, --cpus=2 defaults)

P1.275 Feature ID Max Length Validation ► specs/features.md:28
  - Gap: Spec says IDs must be short, no max length enforced
  - Branch naming truncates to 25 chars but ID validation missing
  - Impact: Long IDs cause branch/container naming issues
  - Fix: Add max length validation (32 chars suggested)

### New P2 Items (Architecture)

P2.112 ZFC Compliance Validation ► specs/zfc-architecture.md:261-280
  - Gap: Spec defines ZFC compliance checklist
  - No orchestrator validation of prompt instructions for ZFC compliance
  - No prevention of semantic analysis patterns (P.263)
  - Impact: Prompts may violate ZFC principles causing inconsistent behavior
  - Fix: Add ZFC compliance linter or validation step for prompt templates

P2.113 Docker Image Update Workflow ► docker/Dockerfile.base, CLAUDE.md
  - Gap: Build command documented but no automated rebuild on changes
  - No script to rebuild image if Dockerfile changes
  - P1.67 validates existence but not freshness
  - Impact: Stale images may have outdated dependencies
  - Fix: Add build-image.sh script, consider image versioning

P2.114 Configuration Schema File ► specs/features.md
  - Gap: Features.json schema in prose but no machine-readable schema
  - No JSON schema file for validation
  - Impact: Validation fragile, client/server mismatches possible
  - Fix: Create features.schema.json, use in validation

### New P3 Items (Robustness)

P3.75 Prompt Template Validation ► templates/*.md
  - Gap: Templates referenced but not validated for syntax/format
  - No versioning or backwards compatibility handling
  - Impact: Malformed templates cause Claude invocation failures
  - Fix: Add template validation step, check required placeholders exist

P3.76 Integration Test for Full Orchestration ► specs/orchestrator.md:6-51
  - Gap: Spec defines complete flow, only unit tests exist
  - No end-to-end test with all major components
  - Impact: Integration issues not caught until manual testing
  - Fix: Create integration test using TestLive layer composition

P3.77 Firewall Network Test Suite ► specs/networking.md:116-133
  - Gap: Spec defines verification commands, no test implementation
  - Cannot verify firewall actually working
  - Impact: Firewall configuration issues not detected
  - Fix: Implement verification test suite for firewall rules

P3.78 Error Recovery Test Cases ► src/program.ts
  - Gap: No tests for partial failure recovery
  - Container created but clone fails - cleanup tested?
  - Signal handling (SIGINT, SIGTERM) not tested
  - Impact: Partial failures may leave orphan resources
  - Fix: Add failure injection tests for recovery paths

P3.79 Subagent Event Handling ► specs/logging-telemetry.md:183-230
  - Gap: Task tool spawns subagents with partial visibility
  - No handling for subagent timing or prompt data
  - Dashboard logging references Task tracking but implementation missing
  - Impact: Subagent work invisible in logs and dashboard
  - Fix: Parse and track Task tool events, correlate with main agent

P3.80 Large Features Array Performance ► dashboard/src/
  - Gap: No handling for 100+ features
  - No pagination or chunking strategy
  - Dashboard.broadcast may saturate network
  - Impact: Performance degradation with many features
  - Fix: Implement pagination or virtual scrolling

### New P4 Items (Polish)

P4.64 Prompt Edit & Re-run UI ► specs/logging-telemetry.md:232-257
  - Gap: Spec details re-run functionality
  - No POST /rerun endpoint
  - No iteration-specific prompt replay UI
  - Impact: Debugging requires full restart
  - Fix: Add re-run API and UI controls

P4.65 Unicode in Feature Descriptions ► specs/features.md
  - Gap: Spec doesn't address non-ASCII characters
  - No handling for CJK, emoji, RTL text
  - JSON escaping may be incomplete
  - Impact: Non-ASCII features may display incorrectly
  - Fix: Ensure proper Unicode handling throughout

### New P5 Items (Consistency)

P5.76 Build Script for Docker Image ► docker/
  - Gap: Manual docker build command in CLAUDE.md
  - No wrapper script for automated builds
  - Impact: Users must remember exact command
  - Fix: Add docker/build-image.sh script

P5.77 Base64 Encoding for Shell Safety ► src/layers/ClaudeLive.ts
  - Gap: P1.49/P1.68 address escaping but not encoding
  - Base64 encoding would eliminate all injection vectors
  - Impact: Shell escaping may have edge cases
  - Fix: Consider base64-encoding sensitive data before shell execution

---

Iteration 23 Dependency Graph Additions:
P1.266 Plan Mode ────────────────────► Core orchestration mode
P1.267 Firewall Verify ──────────────► P1.2 (extends), Security
P1.268 MCP Servers ──────────────────► Claude invocation reliability
P1.269 Feature Dependencies ─────────► P1.47 (extends), Feature ordering
P1.270-271 Logging/Telemetry ────────► New service requirement
P1.272 SSH Permissions ──────────────► Git authentication reliability
P1.273 Env Injection ────────────────► P1.49 (related), Security
P1.274 Resource Limits ──────────────► Container safety
P1.275 ID Length ────────────────────► P1.11 (related), Branch naming

P2.112-114 Architecture ─────────────► Validation and workflows
P3.75-80 Robustness ─────────────────► Testing and edge cases
P4.64-65 Polish ─────────────────────► UI features
P5.76-77 Consistency ────────────────► Build workflow and security

Summary (Iteration 23):
- 10 new P1 items (P1.266-P1.275) - Critical spec gaps
- 3 new P2 items (P2.112-P2.114) - Architecture
- 6 new P3 items (P3.75-P3.80) - Robustness and testing
- 2 new P4 items (P4.64-P4.65) - UI polish
- 2 new P5 items (P5.76-P5.77) - Build and security patterns
- Total new items: 23

Running totals:
- P1 items: 275 (was 265)
- P2 items: 114 (was 111)
- P3 items: 80 (was 74)
- P4 items: 65 (was 63)
- P5 items: 77 (was 75)
- P6 items: 70 (unchanged)
- Grand total: 681 items (was 658)

---

## Iteration 24 Research (Jan 2026)

### New P1 Items (Critical Gaps)

P1.276 GitHub .packages IP Range Missing ► docker/init-firewall.sh:76
  - Gap: Spec includes `.packages` in GitHub IP range extraction
  - Implementation at line 76 only uses `.web + .api + .git`
  - Spec: `jq -r '(.web + .api + .git + .packages)[]'`
  - Code: `jq -r '(.web + .api + .git)[]'`
  - Impact: GitHub packages/container registry may be blocked
  - Fix: Add `.packages` to jq extraction

P1.277 Loopback Rules Added Before Default Policies ► docker/init-firewall.sh:48-50 vs 124-127
  - Gap: Spec shows default policies set as step 5, loopback as step 6
  - Implementation adds loopback at lines 48-50, default policies at 124-127
  - This means rules processed before default DROP policy exists
  - Impact: Ordering inconsistency may cause race conditions during init
  - Fix: Restructure to match spec ordering

P1.278 Host IP Detection Failure Leaves Partial Firewall ► docker/init-firewall.sh:111-114
  - Gap: If HOST_IP detection fails, script exits immediately
  - NAT rules already flushed (line 41) but no firewall rules in place
  - Impact: Container left with no firewall protection on failure
  - Fix: Add rollback/cleanup on error path

P1.279 FeatureEvent Never Sent to Dashboard ► src/server.ts, src/types.ts:46-52
  - Gap: FeatureEvent defined in types with status "pending"|"working"|"passed"
  - Never instantiated or broadcast by server.ts or DashboardLive.ts
  - Only FeaturesEvent (full array) is used
  - Impact: No granular feature status updates to dashboard
  - Fix: Send individual FeatureEvent when feature status changes

P1.280 OutputEvent Data Structure Mismatch ► src/types.ts:38-44 vs specs/dashboard.md:95-98
  - Gap: Spec shows OutputEvent.data as `string`
  - Implementation has `{ text: string, timestamp: number }`
  - Type mismatch between spec and implementation
  - Fix: Align type with spec or update spec

P1.281 IterationEvent Has Extra Field ► src/types.ts:54-60 vs specs/dashboard.md:105-108
  - Gap: Implementation includes `remaining` field not in spec
  - Spec: `{ current: number; max: number }`
  - Code: `{ current: number; max: number; remaining: number }`
  - Impact: Dashboard receiving unexpected field
  - Fix: Document as extension or remove field

P1.282 DashboardLive Initial State Missing Events ► src/layers/DashboardLive.ts:136-140
  - Gap: Only sends state event on SSE connection
  - server.ts sends state, iteration, AND features (lines 137-167)
  - Impact: DashboardLive clients don't receive full initial state
  - Fix: Send iteration and features events after state

P1.283 Orchestrator Never Uses DashboardService ► src/program.ts
  - Gap: program.ts has no DashboardService imports or yield* calls
  - Dashboard receives no updates from Effect-based orchestrator
  - Related to P1.149 but specifically about complete absence of integration
  - Fix: Add DashboardService calls throughout mainLoop

P1.284 Circuit Breaker Logic Has Unreachable Code ► src/program.ts:297, 324-330
  - Gap: Loop condition `noChangeCount < 3` prevents count from reaching 3
  - Final check `finalState.noChangeCount >= 3` can never be true
  - Impact: Circuit breaker never triggers, dead code at lines 324-330
  - Fix: Change to `<=` or remove redundant check

P1.285 DashboardLive Server Never Started ► src/main.ts
  - Gap: DashboardLive.start() method exists but never called
  - No code invokes dashboard server startup
  - Related to P2.2 but at critical level - complete non-functionality
  - Fix: Add dashboard startup to main.ts initialization

P1.286 ClaudeResultEvent Missing "interrupted" Subtype ► src/types.ts:117
  - Gap: Spec shows subtype: "success" | "error" | "interrupted"
  - Implementation only has "success" | "error" | "timeout"
  - Impact: Cannot distinguish interrupted vs errored Claude sessions
  - Fix: Add "interrupted" to subtype union

P1.287 Invalid JSON Aborts Stream Instead of Skipping ► src/streams/ndjson.ts:22-31
  - Gap: Spec requires skipping invalid JSON lines and continuing
  - Implementation produces StreamError, aborting entire stream
  - Impact: Single malformed line kills event processing
  - Fix: Map parse errors to Effect.succeed(null) and filter nulls

P1.288 Empty Features Array Not Validated ► ralph.ts:378-379
  - Gap: Spec says "Orchestrator exits (nothing to do)" for empty array
  - Implementation parses but doesn't check array length
  - Container creation proceeds even with no features
  - Fix: Add `if (features.length === 0) exit` after parse

### New P2 Items (Architecture)

P2.115 DockerService.listByPrefix Signature Incorrect ► src/services/Docker.ts:120-123
  - Gap: Method has `(containerName: string, prefix: string)` signature
  - Purpose is to list containers matching prefix (for cleanup)
  - First param doesn't make sense - should be `(prefix: string)`
  - Impact: Cannot implement cleanupStaleContainers correctly
  - Fix: Change signature to match spec usage pattern

P2.116 Two Parallel Dashboard Implementations ► src/server.ts, src/layers/DashboardLive.ts
  - Gap: Both files implement dashboard server independently
  - server.ts: Global mutable state, complete endpoints
  - DashboardLive.ts: Effect-based, SSE only, missing control endpoints
  - Impact: Maintenance burden, inconsistent behavior
  - Fix: Consolidate to single DashboardLive implementation

P2.117 Prompt File Pattern Not in Effect Implementation ► src/program.ts:239-251
  - Gap: ralph.ts writes prompt to .ralph-prompt.md, invokes Claude with "Read..."
  - program.ts passes prompt directly as CLI argument
  - Spec requires file-based prompt for complex prompts
  - Fix: Implement two-step prompt workflow in program.ts

P2.118 Git Config Duplication Across Entrypoint and Program ► docker/entrypoint.sh:30-33, src/program.ts:122-167
  - Gap: Git configuration performed in TWO places
  - Entrypoint configures credential.helper and SSH
  - program.ts also configures all three settings via docker.exec
  - Impact: Redundant execution, potential inconsistency
  - Fix: Choose one location (prefer entrypoint) and remove other

P2.119 safe.directory Missing from Entrypoint ► docker/entrypoint.sh vs specs/container.md:211
  - Gap: Spec shows git safe.directory should be in entrypoint.sh
  - Only configured later via docker.exec in program.ts
  - Impact: Git operations may fail before program.ts runs
  - Fix: Add `git config --system safe.directory /workspace` to entrypoint.sh

### New P3 Items (Robustness)

P3.81 Firewall Test Cases Incomplete ► docker/init-firewall.sh:143-164
  - Gap: Spec lists tests for webhook.site, httpbin.org, registry.npmjs.org
  - Implementation only tests example.com (blocked) and GitHub/Anthropic (allowed)
  - Impact: Incomplete verification of firewall configuration
  - Fix: Add all spec-defined test cases

P3.82 No IPv6 Firewall Rules ► docker/init-firewall.sh
  - Gap: Only IPv4 iptables rules, no ip6tables handling
  - Services with IPv6 endpoints would bypass firewall
  - Impact: Potential security gap for IPv6-enabled services
  - Fix: Add ip6tables rules or block all IPv6 traffic

P3.83 No CAP_NET_ADMIN Verification ► docker/init-firewall.sh
  - Gap: Firewall requires NET_ADMIN capability
  - No pre-flight check that capability is available
  - Impact: Cryptic iptables errors if capability missing
  - Fix: Add capability check before firewall commands

P3.84 Cost Aggregation Across Iterations Missing ► src/program.ts
  - Gap: Spec mentions aggregating cost across iterations
  - No implementation to sum ClaudeResultEvent.cost_usd
  - Impact: No session-total cost tracking
  - Fix: Add running cost total to iteration state

P3.85 No Retry Logic for DockerError ► src/program.ts:214-266
  - Gap: Spec defines DockerError as recoverable with retry
  - No retry with backoff for Docker failures
  - Impact: Transient Docker failures abort session
  - Fix: Add Effect.retry with exponential backoff for DockerError

P3.86 No Continue Logic for GitError ► src/program.ts
  - Gap: Spec says GitError should log and continue
  - No specific handling for git failures
  - Impact: Git failures may abort instead of continuing
  - Fix: Add catchTag for GitError with continue behavior

### New P4 Items (Polish)

P4.66 Dashboard Feature Sidebar vs Iteration Sidebar ► dashboard/src/App.tsx:84-100
  - Gap: Spec shows two-panel layout with iteration sidebar
  - Implementation only has Features sidebar
  - Impact: No iteration navigation UI
  - Fix: Add IterationSidebar component alongside Features

P4.67 ActivityLog Ignores OutputEvent ► dashboard/src/App.tsx:40-42
  - Gap: Comment marks OutputEvent as "Legacy" and ignores it
  - Spec still defines OutputEvent as current API
  - server.ts still sends OutputEvent
  - Impact: Spec-defined events not displayed
  - Fix: Handle OutputEvent or update spec

P4.68 No Feature Name in Iteration Display ► dashboard/src/App.tsx:62-63
  - Gap: Spec says "Iteration N (or feature name if available)"
  - Only shows numeric iteration count
  - Impact: Less context for user about current work
  - Fix: Display feature name when known

### New P5 Items (Consistency)

P5.78 REJECT ICMP Type Mismatch ► docker/init-firewall.sh:137 vs specs/networking.md:97
  - Gap: Spec uses `icmp-port-unreachable`
  - Implementation uses `icmp-admin-prohibited`
  - Impact: Different rejection behavior than spec
  - Fix: Change to match spec for consistency

P5.79 ClaudeEventMessage Type Name Inconsistency ► src/types.ts:133 vs specs/dashboard.md:116
  - Gap: Spec says type should be "claude"
  - Implementation uses "claude_event"
  - Impact: Type naming inconsistency
  - Fix: Align type name with spec

P5.80 Container Name Uses session- Prefix ► src/container.ts:20 vs specs/container.md:64
  - Gap: Spec shows `ralph-{timestamp}` pattern
  - Implementation generates `ralph-session-${id}`
  - Impact: Name format differs from spec examples
  - Fix: Document as intentional extension or align with spec

### New P6 Items (Minor)

P6.71 Entrypoint.sh Checks Wrong SSH Directory ► docker/entrypoint.sh:15
  - Gap: Checks `/home/node/.ssh` but volume mounts to `/root/.ssh`
  - Overlaps with P1.139 but specific to directory check location
  - Fix: Change check to `/root/.ssh` or change mount point

P6.72 Entrypoint Workspace Chown Not in Spec ► docker/entrypoint.sh:12
  - Gap: Entrypoint has `chown -R node:node /workspace`
  - Not documented in spec's entrypoint section (lines 192-217)
  - Impact: Undocumented behavior
  - Fix: Add to spec or remove with explanation

P6.73 Default CMD in Dockerfile Not in Spec ► docker/Dockerfile.base:78
  - Gap: Dockerfile has `CMD ["claude", "--version"]`
  - Spec shows only ENTRYPOINT, no CMD
  - Impact: Minor deviation from spec
  - Fix: Document or remove

---

Iteration 24 Dependency Graph Additions:
P1.276 GitHub .packages ─────────────────► Firewall completeness
P1.277-278 Firewall Ordering ────────────► Firewall reliability
P1.279-282 Dashboard Events ─────────────► P2.2 Dashboard integration
P1.283 Orchestrator-Dashboard ───────────► P1.149 (extends)
P1.284 Circuit Breaker ──────────────────► Iteration control correctness
P1.285 Dashboard Startup ────────────────► P2.2 (critical blocker)
P1.286-287 Claude Event Handling ────────► Stream processing correctness
P1.288 Features Validation ──────────────► P1.47 (extends)

P2.115-119 Architecture ─────────────────► Code organization
P3.81-86 Robustness ─────────────────────► Error handling and testing
P4.66-68 Dashboard Polish ───────────────► UX improvements
P5.78-80 Consistency ────────────────────► Spec alignment
P6.71-73 Minor ──────────────────────────► Documentation gaps

Summary (Iteration 24):
- 13 new P1 items (P1.276-P1.288) - Firewall, Dashboard, Event handling
- 5 new P2 items (P2.115-P2.119) - Architecture and patterns
- 6 new P3 items (P3.81-P3.86) - Robustness and testing
- 3 new P4 items (P4.66-P4.68) - Dashboard polish
- 3 new P5 items (P5.78-P5.80) - Spec consistency
- 3 new P6 items (P6.71-P6.73) - Documentation
- Total new items: 33

Running totals:
- P1 items: 288 (was 275)
- P2 items: 119 (was 114)
- P3 items: 86 (was 80)
- P4 items: 68 (was 65)
- P5 items: 80 (was 77)
- P6 items: 73 (was 70)
- Grand total: 714 items (was 681)

---

## Iteration 25 Research (Jan 2026)

### New P1 Items (Critical Gaps)

P1.289 Template Uses Fields Not in Features Schema ► templates/ralph-instructions.md:56-67
  - Gap: Template references `acceptance`, `verification`, `steps` fields
  - Spec only defines: `id`, `description`, `passes`, `verify_command` (features.md:6-19)
  - Impact: Claude may expect fields that don't exist in features.json
  - Fix: Update template to use only spec-defined fields

P1.290 PR Title Format Uses Nonexistent Project Name ► templates/ralph-instructions.md:84
  - Gap: `--title "Ralph: {project name from features.json}"` but no project field
  - features.json has `features` array only, no project metadata
  - Impact: Claude cannot generate correct PR title
  - Fix: Define PR title derivation (use first feature slug, or repo name)

P1.291 Build Script Detection Logic Unspecified ► specs/orchestrator.md:109,133
  - Gap: "if build script exists" referenced but no detection method specified
  - Options: Check package.json for scripts.build, try-and-catch, etc.
  - Impact: Inconsistent behavior across different package managers
  - Fix: Specify detection: `jq -e '.scripts.build' package.json`

P1.292 Git Author Name/Email Defaults Missing ► specs/container.md:106-109
  - Gap: Git config commands shown but no default user.name/user.email values
  - Ralph.ts uses "ralph-bot" but not specified in spec
  - Impact: Commits may have empty or inconsistent author info
  - Fix: Document defaults: `Ralph Bot <ralph-bot@noreply.github.com>`

P1.293 Dashboard Port Conflict Handling Missing ► specs/dashboard.md:40-75
  - Gap: No spec for what happens if dashboard port is already in use
  - Bun.serve() will throw if port unavailable
  - Impact: Unclear error message, no recovery path
  - Fix: Add port availability check, increment port or fail with clear message

P1.294 IPSet Destroy Ignores Errors ► docker/init-firewall.sh:27
  - Gap: `ipset destroy allowed-domains 2>/dev/null || true`
  - If ipset is in use by iptables rule, destroy fails silently
  - Previous rules may persist, causing inconsistent state
  - Impact: Firewall may have stale rules on re-initialization
  - Fix: Flush iptables before ipset destroy, verify destruction

P1.295 DNS Resolution Failure Allows Partial Whitelist ► docker/init-firewall.sh:95-98
  - Gap: DNS failure prints warning but continues
  - Some domains may be missing from whitelist
  - Impact: Runtime connection failures to unresolved domains
  - Fix: Either fail fast or add fallback IPs for critical domains

P1.296 Host IP Detection Failure Leaves No Cleanup ► docker/init-firewall.sh:112-115
  - Gap: If HOST_IP detection fails, script exits immediately
  - NAT rules already flushed but no firewall rules applied
  - Overlaps P1.278 but focuses on state after failure
  - Fix: Add cleanup on error or apply minimal firewall before exit

P1.297 CIDR Validation Exits on First Invalid Entry ► docker/init-firewall.sh:70-73
  - Gap: Invalid CIDR causes immediate exit
  - Valid CIDRs before the invalid one already added
  - Impact: Partial firewall state on validation failure
  - Fix: Validate all before adding, or rollback on failure

P1.298 Context Window 200k Hardcoded Without Model Check ► specs/logging-telemetry.md:99
  - Gap: `(totalTokens / 200000) * 100` assumes specific model
  - No fallback for different model context sizes
  - Marked as "open question" at line 362 but needs decision
  - Fix: Make configurable or document model assumption

P1.299 JSONL Session File Permissions Not Specified ► specs/logging-telemetry.md:56
  - Gap: `.ralph/sessions/{session-id}.jsonl` permissions unspecified
  - Security concern: Should be 0600 (owner only) for sensitive data
  - Impact: Session logs may be world-readable
  - Fix: Specify 0600 permissions in spec and implementation

P1.300 Firewall Ready Timeout Value Not in Spec ► src/program.ts:74
  - Gap: P1.2 mentions "30s timeout" but spec just says "wait for message"
  - Implementation detail masquerading as spec requirement
  - Fix: Add timeout value to spec or make configurable

### New P2 Items (Architecture)

P2.120 Subagent Type Values Undocumented ► templates/ralph-instructions.md:42-43
  - Gap: Template uses `subagent_type="Explore"` and `subagent_type="codebase-pattern-finder"`
  - These values not documented in any spec
  - Impact: No validation that these are correct Claude Code values
  - Fix: Document valid subagent_type values in claude-integration.md

P2.121 Cleanup Ordering Not Specified ► specs/orchestrator.md:48-51
  - Gap: "cleanup in finally block" but ordering unspecified
  - Dashboard stop before container? SSE disconnect before server shutdown?
  - Impact: Race conditions in cleanup sequence possible
  - Fix: Document cleanup order: 1) SSE disconnect, 2) Server stop, 3) Container remove

P2.122 Duplicate Error Types in Service Files ► src/services/Docker.ts:6-10
  - Gap: Service files define their own error interfaces
  - Canonical errors in `src/errors/index.ts` already exist
  - Comment at services/index.ts:2 says "import from ../errors"
  - Impact: Duplicate type definitions, potential inconsistency
  - Fix: Remove error interfaces from service files, use errors/index.ts

P2.123 Two SSH Key Mount Locations ► docker/entrypoint.sh:15 vs src/program.ts:37
  - Gap: Entrypoint checks `/home/node/.ssh`, program mounts to same location
  - But spec shows `/root/.ssh` at container.md:238-241
  - Overlaps P6.71 but focuses on source conflict
  - Fix: Align mount location between spec, entrypoint, and program

P2.124 Error Suppression in Entrypoint Not Documented ► docker/entrypoint.sh:20
  - Gap: `chmod 600 /tmp/.ssh/* 2>/dev/null || true` suppresses all errors
  - Spec at container.md:238-241 doesn't show this pattern
  - Impact: Silent failures could cause git auth issues
  - Fix: Document error suppression or add explicit empty-directory handling

### New P3 Items (Robustness)

P3.87 No Retry for GitHub API Fetch ► docker/init-firewall.sh:57
  - Gap: Single curl attempt to api.github.com/meta
  - Network blip or rate limit causes firewall init failure
  - Impact: Container startup fails on transient network issues
  - Fix: Add retry with exponential backoff (3 attempts)

P3.88 No Offline Fallback for GitHub IPs ► docker/init-firewall.sh:55-76
  - Gap: If GitHub API unreachable, firewall init fails
  - Could cache last-known IPs or use documented ranges
  - Impact: Cannot start containers without network access
  - Fix: Bundle fallback IP ranges or cache mechanism

P3.89 IPv6 AAAA Records Not Resolved ► docker/init-firewall.sh:94
  - Gap: Only resolves A records: `dig +noall +answer A "$domain"`
  - IPv6 AAAA records ignored
  - Impact: IPv6-only endpoints not whitelisted
  - Fix: Also resolve AAAA records if IPv6 enabled

P3.90 No CAP_NET_ADMIN Pre-flight Check ► docker/init-firewall.sh
  - Gap: Script requires NET_ADMIN capability
  - No check before attempting iptables commands
  - Overlaps P3.83 but specific to pre-flight
  - Impact: Cryptic iptables permission errors
  - Fix: Check capability at script start: `capsh --print | grep net_admin`

P3.91 Aggregate Command May Not Be Installed ► docker/init-firewall.sh:76
  - Gap: Uses `aggregate -q` for CIDR optimization
  - Package installed at Dockerfile.base:18 but no runtime check
  - Impact: Cryptic error if aggregate missing
  - Fix: Add `command -v aggregate` check at script start

P3.92 Binary Copy Verification Missing ► docker/Dockerfile.base:48-49,56
  - Gap: Copies binaries but doesn't verify they work
  - `bun --version` or `claude --version` not run after copy
  - Impact: Build succeeds with broken binaries
  - Fix: Add version check RUN commands after each binary install

### New P4 Items (Polish)

P4.69 Dashboard Static File MIME Types ► src/server.ts:193-209
  - Gap: No explicit MIME type handling for static files
  - Bun may auto-detect but spec should define
  - Impact: Some browsers may not parse files correctly
  - Fix: Add explicit MIME type mapping for .js, .css, .html

P4.70 Iteration Number Display Format Unspecified ► specs/logging-telemetry.md:81-88
  - Gap: "Iteration 1", "Iteration 2" shown but format details missing
  - Zero-padded? Start from 0 or 1? Max width?
  - Impact: Inconsistent display across UI components
  - Fix: Specify: 1-indexed, no zero-padding, format "Iteration {n}"

P4.71 Session ID Format Example Outdated ► specs/logging-telemetry.md:64
  - Gap: Example `ralph-session-20250115-143052.jsonl`
  - Container naming changed per P5.80
  - Impact: Documentation doesn't match implementation
  - Fix: Update example to match current container naming

### New P5 Items (Consistency)

P5.81 githubusercontent.com Coverage Ambiguous ► docker/init-firewall.sh:76
  - Gap: Uses .packages field from GitHub meta API
  - Unclear if this covers all *.githubusercontent.com subdomains
  - Spec lists `*.githubusercontent.com` explicitly (networking.md:38)
  - Fix: Verify coverage or add explicit DNS resolution

P5.82 Effect Context.Tag Workaround Not Documented ► src/layers/ClaudeLive.ts:135
  - Gap: Three live layers use `as any` workaround
  - Comment references "ralph-progress.txt effect-020" which may not exist
  - Impact: Technical debt without context
  - Fix: Document workaround in code comments or tech-debt.md

P5.83 parseNDJSONWithFallback Silent Catch ► src/streams/ndjson.ts:52-58
  - Gap: Catches JSON parse errors silently, returns text
  - Intentional but could mask protocol errors
  - Impact: May miss malformed JSON from Claude
  - Fix: Document behavior, consider logging parse failures

P5.84 Test Mock Type Assertions ► src/program.test.ts:44
  - Gap: Tests use `as any` to create mock services
  - Not a bug but could hide type errors in tests
  - Impact: Mocks may drift from actual interface
  - Fix: Create properly-typed test factories

### New P6 Items (Minor)

P6.74 Ralph Wiggum Technique Doc Missing ► specs/README.md:62-67
  - Gap: Spec references thoughts/shared/reference/ralph-wiggum-technique.md
  - File may not exist
  - Impact: Documentation link 404
  - Fix: Create document or remove reference

P6.75 Dockerfile CMD Overridden by Orchestrator ► docker/Dockerfile.base:78
  - Gap: `CMD ["claude", "--version"]` always overridden
  - Serves no runtime purpose, only useful for manual testing
  - Overlaps P6.73 but notes why it exists
  - Impact: Minor confusion
  - Fix: Add comment explaining purpose

P6.76 gosu vs sudo Best Practice Not Documented ► docker/entrypoint.sh:37
  - Gap: Uses `exec gosu node "$@"` but no comment explaining why
  - gosu is Docker best practice for privilege dropping
  - Impact: Maintainers may not understand the choice
  - Fix: Add comment: "gosu handles signals better than sudo in containers"

---

Iteration 25 Dependency Graph Additions:
P1.289-290 Template Issues ──────────────► Feature parsing, PR creation
P1.291-292 Build/Git Config ─────────────► Container setup correctness
P1.293 Dashboard Port ───────────────────► Dashboard reliability
P1.294-297 Firewall Robustness ──────────► P1.276-278 (extends)
P1.298-299 Spec Gaps ────────────────────► Documentation completeness
P1.300 Timeout Spec ─────────────────────► P1.2 (clarifies)

P2.120-124 Architecture ─────────────────► Code organization and patterns
P3.87-92 Robustness ─────────────────────► Failure handling
P4.69-71 Polish ─────────────────────────► UI and documentation
P5.81-84 Consistency ────────────────────► Code quality
P6.74-76 Minor ──────────────────────────► Documentation

Summary (Iteration 25):
- 12 new P1 items (P1.289-P1.300) - Template, firewall, spec gaps
- 5 new P2 items (P2.120-P2.124) - Architecture and patterns
- 6 new P3 items (P3.87-P3.92) - Robustness
- 3 new P4 items (P4.69-P4.71) - Polish
- 4 new P5 items (P5.81-P5.84) - Consistency
- 3 new P6 items (P6.74-P6.76) - Documentation
- Total new items: 33

Running totals:
- P1 items: 300 (was 288)
- P2 items: 124 (was 119)
- P3 items: 92 (was 86)
- P4 items: 71 (was 68)
- P5 items: 84 (was 80)
- P6 items: 76 (was 73)
- Grand total: 747 items (was 714)
- Grand total: 747 items (was 714)

---

## Iteration 26: Deep Gap Analysis

### New P1 Items (Critical)

P1.301 NDJSON Parser Fails on Invalid JSON Instead of Skipping ► src/streams/ndjson.ts:22-30
  - Gap: Spec (claude-integration.md:116-118) says "skip invalid lines and continue"
  - Implementation uses Stream.mapEffect which fails stream on first error
  - Should use Stream.filterMap or error recovery pattern
  - Impact: Single malformed JSON line aborts entire Claude output stream
  - Fix: Wrap JSON.parse in Effect.option and filter None values

P1.302 "interrupted" Subtype Missing from ClaudeResultEvent ► src/types.ts:117
  - Gap: Spec (claude-integration.md:78) defines "success" | "error" | "interrupted"
  - Implementation only has "success" | "error"
  - Impact: Cannot properly handle interrupted Claude executions
  - Fix: Add "interrupted" to ClaudeResultEvent.subtype union

P1.303 mcp_servers Type Mismatch ► src/types.ts:86
  - Gap: Spec defines mcp_servers: string[]
  - Implementation uses Record<string, unknown>[]
  - Impact: Type errors when processing init events
  - Fix: Align type with actual Claude CLI output

P1.304 Template Uses "verification" Field, Code Uses "verify_command" ► templates/ralph-instructions.md:56
  - Gap: Template shows `"verification": "test -f ..."` 
  - Feature interface uses `verify_command?: string`
  - Impact: Claude writes wrong field name, verification never runs
  - Fix: Align template with Feature interface (use verify_command)

P1.305 Missing "acceptance" and "steps" Fields in Feature Interface ► src/types.ts:3-8
  - Gap: Template shows optional "acceptance" and "steps" fields
  - Feature interface doesn't include them
  - Impact: TypeScript errors if features.json includes these fields
  - Fix: Add optional fields to Feature interface

P1.306 No Feature Schema Validation ► src/container.ts:42, ralph.ts:378
  - Gap: Spec (features.md:247-248) says "exit with error" for invalid JSON
  - Implementation uses raw JSON.parse with no validation
  - Missing required fields not caught
  - Impact: Runtime errors instead of clear validation messages
  - Fix: Add schema validation with Zod or Effect Schema

P1.307 DockerService.listByPrefix Searches Files Not Containers ► src/layers/DockerLive.ts:292-318
  - Gap: Method name implies listing containers by prefix
  - Implementation actually searches /workspace filesystem
  - Used by cleanupStaleContainers but wrong semantics
  - Impact: Stale container cleanup doesn't work correctly
  - Fix: Implement actual `docker ps -a --filter name=prefix` pattern

P1.308 DashboardLive Missing All Control Endpoints ► src/layers/DashboardLive.ts:112-179
  - Gap: Only implements /events and static files
  - Missing: /pause, /resume, /step-mode, /stop, /prompt GET/PUT
  - These exist in src/server.ts but not in Effect layer
  - Impact: Dashboard cannot control orchestrator through Effect implementation
  - Fix: Port all endpoints from server.ts to DashboardLive.ts

P1.309 onStopCallback Not Implemented in DashboardLive ► src/layers/DashboardLive.ts
  - Gap: src/server.ts has setOnStopCallback() for Claude abort
  - DashboardLive has no equivalent mechanism
  - Impact: Stop button cannot abort Claude process
  - Fix: Add onStopCallback mechanism to DashboardLive

P1.310 Initial SSE Connection Missing Iteration/Features Events ► src/layers/DashboardLive.ts:136-140
  - Gap: Only sends StateEvent on initial connection
  - Spec/server.ts sends state + iteration + features events
  - Impact: Dashboard doesn't show iteration/features on reconnect
  - Fix: Send all three events on SSE connection

P1.311 LoggingService Completely Missing ► specs/logging-telemetry.md:49-56
  - Gap: Entire LoggingService interface not implemented
  - No src/services/Logging.ts or src/layers/LoggingLive.ts
  - Impact: No JSONL session persistence, no iteration recovery
  - Fix: Implement LoggingService per spec

P1.312 Iteration Metrics Not Tracked ► specs/logging-telemetry.md:89-102
  - Gap: IterationMetrics type not defined
  - Token usage from ClaudeResultEvent.message.usage not tracked per iteration
  - Impact: No visibility into token consumption, context usage
  - Fix: Add IterationMetrics type and tracking logic

P1.313 /iterations and /logs/:iteration Endpoints Missing ► specs/logging-telemetry.md:272-284
  - Gap: Neither endpoint exists in server.ts or DashboardLive
  - Required for iteration sidebar and log replay
  - Impact: Cannot view historical iterations in dashboard
  - Fix: Implement both endpoints

P1.314 TimeoutError Not Caught in mainLoop ► src/program.ts:241-251
  - Gap: Claude.run() called without catching TimeoutError
  - Spec says orchestrator should catch and increment noChangeCount
  - Impact: Timeout propagates uncaught, crashes orchestrator
  - Fix: Add Effect.catchTag for TimeoutError

P1.315 GitHub .packages Field Not Included in Firewall ► docker/init-firewall.sh:76
  - Gap: Spec shows (web + api + git + .packages)
  - Implementation only uses (web + api + git)
  - Impact: GitHub Packages CDN endpoints blocked
  - Fix: Add .packages to jq filter

P1.316 *.githubusercontent.com Not Whitelisted ► specs/networking.md:37 vs docker/init-firewall.sh
  - Gap: Spec explicitly lists *.githubusercontent.com
  - Not resolved or added to allowed-domains ipset
  - Impact: Cannot fetch raw files from GitHub repos
  - Fix: Add DNS resolution for raw.githubusercontent.com, etc.

P1.317 DNS over TCP (Port 53) Not Allowed ► docker/init-firewall.sh:41-43
  - Gap: Only UDP DNS allowed
  - TCP needed for large responses (DNSSEC)
  - Impact: DNS resolution may fail for some domains
  - Fix: Add iptables rules for TCP port 53

P1.318 Dashboard Event Type Mismatch ► dashboard.md:116 vs src/types.ts:133
  - Gap: Spec says type: "claude"
  - Implementation uses type: "claude_event"
  - Impact: Dashboard code may not match events
  - Fix: Align naming between spec and types.ts

P1.319 maxIterations Initialized to 0 in DashboardLive ► src/layers/DashboardLive.ts:214
  - Gap: maxIterations: 0 as initial value
  - Should default to config value (50 per spec)
  - Impact: Progress bar shows 0/0 until first update
  - Fix: Pass config value to makeDashboardLive

P1.320 Timeout Config Not Used ► src/program.ts:244
  - Gap: Hardcodes timeoutMs: 10 * 60 * 1000
  - ConfigService has timeoutMs field that's ignored
  - Impact: Timeout not configurable at runtime
  - Fix: Use config.timeoutMs instead of hardcoded value

### New P2 Items (Architecture)

P2.125 Two Server Implementations Exist ► src/server.ts vs src/layers/DashboardLive.ts
  - Gap: server.ts has full implementation (301 lines)
  - DashboardLive.ts is incomplete subset
  - Unclear which is canonical
  - Impact: Feature drift between implementations
  - Fix: Complete DashboardLive.ts, deprecate server.ts

P2.126 Test Mocks Use as any Type Assertions ► src/program.test.ts:44,90,141
  - Gap: 15+ occurrences of `as any` in test files
  - Bypasses type checking for mock services
  - Impact: Mocks may drift from actual interfaces
  - Fix: Create properly-typed mock factories in layers/test/

P2.127 Console.log Used Extensively Instead of Logging Service ► ralph.ts (40+ occurrences)
  - Gap: 40+ console.log calls for status updates
  - No structured logging, no LoggingService integration
  - Impact: Cannot filter/search logs, no persistence
  - Fix: Route through LoggingService when implemented

P2.128 Process.exit() Calls Bypass Effect Error Handling ► ralph.ts:89,360,367,376,395
  - Gap: 5 direct process.exit(1) calls
  - Bypasses Effect cleanup and error propagation
  - Impact: Resources may not be cleaned up on exit
  - Fix: Return Effect failures instead, handle at top level

P2.129 Circuit Breaker Doesn't Track Feature Progress ► src/program.ts:295-296
  - Gap: Only checks noChangeCount and remainingFeaturesCount
  - Doesn't detect commits without feature completion
  - Impact: Infinite loop if Claude pushes without completing features
  - Fix: Track feature progress rate, not just count

P2.130 ClaudeEvent Types Missing tool_result ► src/types.ts:95-102
  - Gap: ContentBlock has text/tool_use/thinking
  - Spec shows tool_result as separate type
  - Flat union with optional fields not discriminated
  - Impact: Cannot properly type tool results
  - Fix: Add discriminated union for tool_result

P2.131 Thinking Content Type Undocumented ► src/types.ts:96
  - Gap: Implementation has "thinking" content type
  - Not documented in claude-integration.md spec
  - Impact: Spec/impl divergence
  - Fix: Document thinking content type in spec

### New P3 Items (Robustness)

P3.93 DNS Staleness for Long-Running Containers ► docker/init-firewall.sh:92-108
  - Gap: DNS resolved once at startup
  - CDNs rotate IPs frequently
  - Impact: Long-running containers lose connectivity
  - Fix: Periodic DNS refresh or TTL-aware caching

P3.94 No CNAME Chain Following ► docker/init-firewall.sh:94
  - Gap: Only A records extracted
  - CNAME targets not tracked
  - Impact: Access to canonical names may fail
  - Fix: Document behavior or follow CNAME chain

P3.95 Host Network Detection Assumes /24 Subnet ► docker/init-firewall.sh:116
  - Gap: Hardcodes .0/24 for host network
  - Custom Docker networks use different masks
  - Impact: Container-host communication may fail
  - Fix: Detect actual subnet mask from route

P3.96 Firewall Init Partial Failure Leaves No Connectivity ► docker/init-firewall.sh:12
  - Gap: set -e exits on any error
  - No cleanup of partial firewall state
  - Impact: Failed init leaves container unreachable
  - Fix: Add trap handler to restore default rules on failure

P3.97 No Validation of Claude CLI Output Format ► src/layers/ClaudeLive.ts:87
  - Gap: Forces --output-format stream-json
  - No validation that response is actually NDJSON
  - Impact: Text response would crash stream parser
  - Fix: Detect content type or validate first line

P3.98 GitHub CLI apt Repository Not Firewalled ► docker/Dockerfile.base:33-35
  - Gap: cli.github.com used during build
  - May resolve to IPs outside allowed GitHub ranges
  - Impact: Runtime apt updates would fail
  - Fix: Not critical (build-time only), document limitation

### New P4 Items (Polish)

P4.72 Token Usage Not Displayed in Dashboard ► specs/logging-telemetry.md:79-102
  - Gap: ClaudeResultEvent has usage field
  - No UI component displays token counts
  - Impact: No visibility into token consumption
  - Fix: Add token display to iteration cards

P4.73 Cost Not Displayed in Dashboard ► src/types.ts:118
  - Gap: cost_usd field exists in ClaudeResultEvent
  - Not tracked or displayed
  - Impact: No cost visibility
  - Fix: Add cost display per iteration

P4.74 Duration Not Displayed in Dashboard ► src/types.ts:119
  - Gap: duration_ms field exists
  - Not displayed
  - Impact: No timing visibility
  - Fix: Add duration display

P4.75 ToolCall.tsx Component Missing ► specs/logging-telemetry.md:332-345
  - Gap: Spec lists ToolCall.tsx as required
  - File does not exist
  - Impact: No structured tool call rendering
  - Fix: Implement ToolCall component

P4.76 SubagentIndicator.tsx Component Missing ► specs/logging-telemetry.md:332-345
  - Gap: Spec lists SubagentIndicator.tsx as required
  - File does not exist
  - Impact: No subagent visibility in dashboard
  - Fix: Implement SubagentIndicator component

P4.77 useSessionRecovery.ts Hook Missing ► specs/logging-telemetry.md:332-345
  - Gap: Spec lists useSessionRecovery.ts as required
  - File does not exist
  - Impact: No browser recovery on reconnect
  - Fix: Implement session recovery hook

P4.78 IterationSidebar.tsx Component Missing ► specs/logging-telemetry.md:332-345
  - Gap: Spec lists IterationSidebar.tsx as required
  - File does not exist
  - Impact: Cannot view/switch between iterations
  - Fix: Implement iteration sidebar

### New P5 Items (Consistency)

P5.85 run() vs runWithEvents() Timeout Behavior Differs ► src/layers/ClaudeLive.ts:51,118
  - Gap: run() uses Effect.timeout(), runWithEvents() uses Stream.timeout()
  - Spec only documents runWithEvents() timeout behavior
  - Impact: Inconsistent timeout semantics
  - Fix: Document both behaviors or unify approach

P5.86 DockerTest Mock Doesn't Match Production Commands ► src/layers/test/DockerTest.ts:28-42
  - Gap: Mock exec has limited command patterns
  - Real implementation handles many more commands
  - Impact: Tests may pass but production fails
  - Fix: Expand mock patterns or use command recording

P5.87 ClaudeTest Mock Returns Wrong Event Types ► src/layers/test/ClaudeTest.ts:13-16
  - Gap: Mock returns simple objects
  - Don't match ClaudeEvent types (init, assistant, result)
  - Impact: Tests don't verify event handling
  - Fix: Return properly-typed mock events

P5.88 ICMP Rejection Method Differs from Spec ► docker/init-firewall.sh:137
  - Gap: Spec shows icmp-port-unreachable
  - Impl uses icmp-admin-prohibited
  - Actually better, but inconsistent with spec
  - Fix: Update spec to match (admin-prohibited is correct)

### New P6 Items (Minor)

P6.77 Prompt Rerun Endpoint Not Implemented ► specs/logging-telemetry.md:244-254
  - Gap: POST /rerun specified for prompt iteration
  - Endpoint doesn't exist
  - Low priority feature
  - Impact: Cannot re-run with modified prompts
  - Fix: Implement when needed

P6.78 bun.sh Not Whitelisted for Runtime Updates ► docker/init-firewall.sh
  - Gap: bun.sh used in Dockerfile build
  - Not whitelisted for container runtime
  - Impact: Cannot update Bun inside container
  - Low priority (version pinned at build)
  - Fix: Document or add if needed

P6.79 claude.ai Not Whitelisted ► docker/init-firewall.sh
  - Gap: Claude installer from claude.ai during build
  - Not whitelisted for runtime
  - Impact: Cannot update Claude CLI inside container
  - Low priority (version pinned at build)
  - Fix: Document limitation

### New P7 Items (Test Coverage)

P7.1 createSession Function Has No Tests ► src/program.ts:23-200
  - Gap: 177-line function with 8 distinct steps
  - Only runIteration and mainLoop tested
  - Impact: Container setup may silently break
  - Fix: Add integration tests for createSession

P7.2 DockerLive Layer Has No Tests ► src/layers/DockerLive.ts (325 lines)
  - Gap: All Docker operations untested
  - Only tested indirectly through program.test.ts
  - Impact: Docker API changes may break silently
  - Fix: Add unit tests for each Docker method

P7.3 ClaudeLive Layer Has No Tests ► src/layers/ClaudeLive.ts (138 lines)
  - Gap: Claude CLI integration untested
  - Impact: Claude CLI changes may break silently
  - Fix: Add tests for argument building, timeout, streaming

P7.4 GitLive Layer Has No Tests ► src/layers/GitLive.ts (141 lines)
  - Gap: Git operations untested
  - Impact: Git behavior changes may break silently
  - Fix: Add tests for each git method

P7.5 ConfigLive Layer Has No Tests ► src/layers/ConfigLive.ts (68 lines)
  - Gap: Environment variable handling untested
  - Impact: Config loading may silently fail
  - Fix: Add tests for env var validation

P7.6 DashboardLive Layer Has No Tests ► src/layers/DashboardLive.ts (217 lines)
  - Gap: SSE server, state management untested
  - Impact: Dashboard may break silently
  - Fix: Add SSE and endpoint tests

P7.7 server.ts Has No Tests ► src/server.ts (301 lines)
  - Gap: Full dashboard server untested
  - Impact: HTTP endpoints may break
  - Fix: Add endpoint tests

P7.8 Stream Utilities Partially Tested ► src/streams/ndjson.ts
  - Gap: parseNDJSONWithFallback, fromReadableStream, collectAll, forEach untested
  - Only parseNDJSON has tests
  - Impact: Stream utilities may have bugs
  - Fix: Add tests for all exported functions

P7.9 main.ts Entry Point Has No Tests ► src/main.ts (68 lines)
  - Gap: Entry point logic untested
  - Impact: Startup may fail silently
  - Fix: Add integration tests

P7.10 Feature Schema Validation Not Tested ► src/container.ts:41-44
  - Gap: No validation logic exists to test
  - Impact: Invalid features.json not caught
  - Fix: First implement validation (P1.306), then test

---

Iteration 26 Dependency Graph:
P1.301 NDJSON Parser ───────────────────► Stream reliability
P1.302-303 Event Types ─────────────────► Type safety
P1.304-306 Feature Schema ──────────────► Feature verification
P1.307 listByPrefix ────────────────────► P1.9 Startup Cleanup
P1.308-310 Dashboard Endpoints ─────────► P4.75-78 Dashboard UI
P1.311-313 Logging System ──────────────► Full spec compliance
P1.314 TimeoutError ────────────────────► Error handling
P1.315-317 Firewall ────────────────────► Network security
P1.318-320 Config/Types ────────────────► Correctness

P2.125-131 Architecture ────────────────► Code quality
P3.93-98 Robustness ────────────────────► Reliability
P4.72-78 Dashboard UI ──────────────────► User experience
P5.85-88 Consistency ───────────────────► Maintainability
P6.77-79 Minor ─────────────────────────► Future features
P7.1-10 Test Coverage ──────────────────► Quality assurance

Summary (Iteration 26):
- 20 new P1 items (P1.301-P1.320) - Critical gaps from deep analysis
- 7 new P2 items (P2.125-P2.131) - Architecture issues
- 6 new P3 items (P3.93-P3.98) - Robustness gaps
- 7 new P4 items (P4.72-P4.78) - Dashboard polish
- 4 new P5 items (P5.85-P5.88) - Consistency issues
- 3 new P6 items (P6.77-P6.79) - Minor issues
- 10 new P7 items (P7.1-P7.10) - Test coverage (new category)
- Total new items: 57

Running totals:
- P1 items: 320 (was 300)
- P2 items: 131 (was 124)
- P3 items: 98 (was 92)
- P4 items: 78 (was 71)
- P5 items: 88 (was 84)
- P6 items: 79 (was 76)
- P7 items: 10 (new category)
- Grand total: 804 items (was 747)

---

## Iteration 27: Deep Analysis (Jan 2026)

### Research Focus
- Deep spec analysis (networking, container, logging-telemetry)
- Layer implementation review (ClaudeLive, DockerLive, GitLive, ConfigLive, DashboardLive)
- Container security and Docker configuration
- Test coverage detailed analysis

### New P1 Items (Critical)

P1.321 Firewall Rule Ordering Mismatch ► docker/init-firewall.sh:39-51,124-137
  - Gap: Loopback and DNS rules added BEFORE default DROP policies
  - Spec shows default policies should be set first for security
  - Impact: Time window where traffic isn't properly blocked during init
  - Fix: Reorder to set default DROP policies before exception rules

P1.322 Host Network Auto-Detection Validation Missing ► docker/init-firewall.sh:110-122
  - Gap: Detects host network via `ip route | grep default`
  - If detection fails, firewall init fails with no fallback
  - No validation that detected network is sensible (not 0.0.0.0)
  - Impact: False positives, container startup failures
  - Fix: Add network validation and fallback handling

P1.323 Docker DNS Rule Preservation Fragility ► docker/init-firewall.sh:17-37
  - Gap: Saves DNS rules with `iptables-save | grep "127.0.0.11"`
  - Restores with `xargs -L 1 iptables -t nat`
  - If Docker changes rule format, parsing breaks
  - Impact: DNS resolution fails, breaks all network operations
  - Fix: Add rule format validation before restore

P1.324 Entrypoint SSH Key Path Mismatch ► docker/entrypoint.sh:15-28
  - Gap: Checks for `/home/node/.ssh` but spec shows mount at `/root/.ssh:ro`
  - Line 15 checks wrong path, lines 23-26 may configure with missing keys
  - Impact: SSH git operations fail silently
  - Fix: Align paths between mount and entrypoint check

P1.325 Git Config Conditional on GITHUB_TOKEN ► docker/entrypoint.sh:30-33
  - Gap: Only configures credential helper if GITHUB_TOKEN is set
  - Users with gh CLI configured via SSO/device auth blocked
  - Impact: Cannot clone private repos via HTTPS without env var
  - Fix: Configure helper unconditionally, let gh CLI handle auth

P1.326 Entrypoint Never Validates Firewall Actually Ready ► docker/entrypoint.sh:8-9
  - Gap: Calls init-firewall.sh and immediately proceeds
  - If script exits 0 but firewall isn't functional, no detection
  - Impact: Container starts with non-functional firewall
  - Fix: Add verification check before dropping privileges

P1.327 Ralph Progress File Never Created ► templates/ralph-instructions.md:16,33,190-217
  - Gap: Template instructs Claude to read/write ralph-progress.txt
  - No code creates this file or ensures it exists
  - Impact: Claude gets error on first iteration trying to read progress
  - Fix: Create progress file during session creation

P1.328 Verification Command Execution Not Implemented ► specs/orchestrator.md:101-123
  - Gap: Orchestrator never runs verify_command from features.json
  - Relies entirely on Claude to run verification
  - Spec says orchestrator should enforce verification as gate
  - Impact: Claude can skip verification and mark passes:true without running checks
  - Fix: Implement verify_command execution in mainLoop

P1.329 No Container Name in Iteration State ► src/program.ts:290-291
  - Gap: Initial state has iteration, noChangeCount, remainingFeaturesCount
  - Spec at line 210 shows containerName is part of state
  - Impact: Cannot reference container from within iteration loop
  - Fix: Add containerName to IterationState type and initial state

P1.330 Type Mismatch: tool_result Not in ContentBlock ► src/types.ts:95-102
  - Gap: ContentBlock union includes tool_use but no tool_result
  - Spec shows tool_result events exist in stream
  - Impact: Runtime errors when parsing tool_result events
  - Fix: Add tool_result to ContentBlock union type

P1.331 Command Injection in ClaudeLive Prompt ► src/layers/ClaudeLive.ts:41,89
  - Gap: Prompt wrapped in double quotes with no escaping
  - Shell metacharacters (quotes, backticks) not escaped
  - Impact: Security vulnerability, command injection via malicious prompts
  - Fix: Use proper shell escaping or pass prompt via stdin

P1.332 Command Injection in DockerLive.listByPrefix ► src/layers/DockerLive.ts:296
  - Gap: Prefix interpolated directly into shell command
  - Single quotes or metacharacters break command
  - Impact: Security vulnerability, command injection via prefix
  - Fix: Use proper shell escaping for prefix parameter

P1.333 Command Injection in GitLive All Operations ► src/layers/GitLive.ts:33,47,66,81,97,113,131,135
  - Gap: Branch names, user name, email concatenated directly into commands
  - No validation or escaping for shell metacharacters
  - Impact: Security vulnerability, arbitrary command execution
  - Fix: Validate inputs and use proper escaping

P1.334 No IPv6 Filtering in Firewall ► docker/init-firewall.sh:21-26
  - Gap: Script only configures iptables (IPv4)
  - No ip6tables rules at all
  - If container has IPv6 connectivity, all IPv6 traffic unrestricted
  - Impact: IPv6 traffic bypasses entire firewall
  - Fix: Add parallel ip6tables rules or disable IPv6

P1.335 Insecure Git SSH Configuration ► docker/entrypoint.sh:26
  - Gap: Uses StrictHostKeyChecking=no, UserKnownHostsFile=/dev/null
  - Disables host key verification
  - Impact: SSH connections vulnerable to MITM attacks
  - Fix: Pre-populate known_hosts with GitHub keys or verify fingerprints

P1.336 No Seccomp Profile for Container ► src/services/Docker.ts:13-21
  - Gap: ContainerConfig lacks securityOpt field
  - No seccomp profile restricts system calls
  - Impact: Container has access to all system calls
  - Fix: Add seccomp profile configuration and apply restrictive profile

P1.337 Secrets in Environment Variables ► src/program.ts:42-43
  - Gap: OAUTH_TOKEN and GITHUB_TOKEN passed as env vars
  - Visible in docker inspect, process listings, child processes
  - Impact: Secrets exposed to all container processes
  - Fix: Use Docker secrets or inject via file

P1.338 No Timeout for Firewall Initialization ► src/program.ts:70-75
  - Gap: Fixed 3-second sleep instead of detecting "Ralph Firewall Ready"
  - If firewall takes longer, orchestrator proceeds too early
  - Comment acknowledges as TODO but not implemented
  - Impact: Race condition, operations start before firewall ready
  - Fix: Implement log streaming detection with timeout fallback

P1.339 DashboardLive Path Traversal Vulnerability ► src/layers/DashboardLive.ts:111,168
  - Gap: dashboardPath + filePath concatenation without validation
  - No checks for path traversal (../)
  - Impact: Clients could request /../../../etc/passwd
  - Fix: Validate and normalize path, reject traversal

P1.340 No Resource Limits for Containers ► src/services/Docker.ts:13-21
  - Gap: ContainerConfig lacks memory, cpus, pidsLimit fields
  - Containers can consume unlimited host resources
  - Impact: Runaway process could DoS host
  - Fix: Add resource limit fields and set reasonable defaults

### New P2 Items (Architecture)

P2.132 Missing Error Preservation in ClaudeLive ► src/layers/ClaudeLive.ts:61-63,128-130
  - Gap: DockerError's command, exitCode, stderr lost when mapping
  - Only cause field preserved
  - Impact: Loss of debugging information
  - Fix: Preserve all error context in ClaudeError

P2.133 Hardcoded Model ID in Two Locations ► src/layers/ClaudeLive.ts:27,76
  - Gap: Model "claude-opus-4-5-20251101" hardcoded twice
  - If one updated but not other, inconsistency
  - Impact: Maintenance burden, potential for drift
  - Fix: Extract to constant or config

P2.134 No Scoped Resource Management for execStream ► src/layers/ClaudeLive.ts:94-100
  - Gap: execStream returns scoped Effect, wrapped in Stream.unwrap
  - No explicit scope management for the unwrap
  - Impact: Potential resource leak if stream not properly closed
  - Fix: Ensure proper scope management for streamed resources

P2.135 Race Condition in Docker inspect() ► src/layers/DockerLive.ts:137-197
  - Gap: Three separate docker inspect calls for state/status/id
  - Container state could change between calls
  - Impact: Inconsistent ContainerInfo with contradictory data
  - Fix: Single docker inspect call, parse all fields

P2.136 TextDecoder Shared Across Streams ► src/layers/DockerLive.ts:232
  - Gap: Single TextDecoder instance decodes both stdout and stderr
  - TextDecoder maintains state for multi-byte sequences
  - Impact: Multi-byte chars split across chunks could corrupt decoding
  - Fix: Separate TextDecoder per stream

P2.137 No Timeout on Docker Commands ► src/layers/DockerLive.ts (all)
  - Gap: Docker command executions have no timeouts
  - Commands can hang indefinitely if daemon unresponsive
  - Impact: Operations hang forever, no recovery
  - Fix: Add configurable timeouts to all Docker operations

P2.138 Race Condition in DashboardLive State Updates ► src/layers/DashboardLive.ts:54-59
  - Gap: updateAndBroadcast reads and updates in two operations
  - Between Ref.update and Ref.get, concurrent update could occur
  - Impact: SSE clients could receive stale state
  - Fix: Use single Ref.modify or atomic update-and-get

P2.139 No Error Propagation from Effect.runSync ► src/layers/DashboardLive.ts:127-133,136,145-151
  - Gap: Multiple runSync calls without error handling
  - If Ref operations fail, runSync throws uncaught exception
  - Impact: Unhandled exceptions crash SSE server
  - Fix: Wrap runSync in try-catch or use runSyncExit

P2.140 Duplicate Implementation createBranch vs checkout ► src/layers/GitLive.ts:19-44,112-122
  - Gap: Both execute `git checkout -b <branch>` with different error handling
  - Functionality duplicated
  - Impact: Bugs need fixing in two places, inconsistent errors
  - Fix: Consolidate into single implementation

P2.141 No Handling of Detached HEAD State ► src/layers/GitLive.ts:80-91
  - Gap: hasUnpushedCommits uses git branch --show-current
  - In detached HEAD, returns empty string
  - Would construct invalid "origin//HEAD" in log command
  - Impact: Method fails with confusing git error
  - Fix: Detect and handle detached HEAD explicitly

P2.142 Missing Client Cleanup in DashboardLive ► src/layers/DashboardLive.ts:28-34
  - Gap: Broadcast catches errors silently, comment says "will be removed on next cleanup"
  - No cleanup mechanism implemented
  - Impact: Dead clients accumulate, memory leak, wasted CPU on broadcasts
  - Fix: Implement periodic cleanup or immediate removal on error

P2.143 outputFormat Flag Ignored in runWithEvents ► src/layers/ClaudeLive.ts:87
  - Gap: Forces --output-format stream-json regardless of options
  - run() respects outputFormat flag, runWithEvents() doesn't
  - Impact: Inconsistent API behavior
  - Fix: Document behavior or allow override

P2.144 Server Stop Doesn't Close Active Connections ► src/layers/DashboardLive.ts:181-187,191-197
  - Gap: stop() calls server.stop() but doesn't close SSE clients
  - Clients in clientsRef are orphaned
  - Impact: Clients timeout rather than receiving clean closure
  - Fix: Close all client controllers before stopping server

### New P3 Items (Robustness)

P3.99 No Retry on GitHub API Failure ► docker/init-firewall.sh:57-62
  - Gap: Single curl to api.github.com/meta
  - Network blip or rate limit causes immediate failure
  - Impact: Transient failures block container startup
  - Fix: Add retry with exponential backoff

P3.100 No Fallback GitHub IP Ranges ► docker/init-firewall.sh:55-76
  - Gap: If GitHub API down, firewall init fails
  - Could bundle known IP ranges as fallback
  - Impact: Container startup fails when GitHub API unavailable
  - Fix: Add bundled fallback IP ranges

P3.101 Firewall Rules Not Idempotent ► docker/init-firewall.sh:20-27
  - Gap: Flushes all rules and recreates from scratch
  - If run twice, ipset destroy may fail if set not empty
  - Impact: Container restart fragility
  - Fix: Use idempotent rule creation patterns

P3.102 TOCTOU for IP Resolution ► docker/init-firewall.sh:92-108
  - Gap: Domain names resolved once at startup
  - IPs can change (especially CloudFlare-hosted sites)
  - Impact: Legitimate services become unreachable after IP change
  - Fix: Use broader CIDR ranges or refresh resolution periodically

P3.103 Host Network Detection Assumes /24 ► docker/init-firewall.sh:117
  - Gap: Uses sed to convert to .0/24 regardless of actual mask
  - Incorrect for /16, /25+ networks
  - Impact: May allow/block wrong IP ranges
  - Fix: Detect actual subnet mask from ip route output

P3.104 Incomplete Firewall Verification Tests ► docker/init-firewall.sh:139-168
  - Gap: Only tests blocked domain, GitHub API, Anthropic API
  - Missing: SSH port 22, DNS resolution, host network, IPv6
  - Impact: Partial verification may miss failures
  - Fix: Add comprehensive verification tests

P3.105 No Container Name Validation ► src/layers/DockerLive.ts:100-318
  - Gap: All methods accept containerName without validation
  - Docker has name restrictions (alphanumeric, hyphens, underscores)
  - Impact: Invalid names cause cryptic Docker errors
  - Fix: Validate container names before use

P3.106 No Branch Name Validation ► src/layers/GitLive.ts:20,46,112
  - Gap: Branch names accepted without validation
  - Git has restrictions (no spaces, certain chars, no leading -)
  - Impact: Invalid names cause cryptic git errors
  - Fix: Validate branch names before use

P3.107 No Validation for configureUser Inputs ► src/layers/GitLive.ts:124-137
  - Gap: User name and email interpolated without validation
  - No length limits, special char checks, email format validation
  - Impact: Invalid values break git config or enable injection
  - Fix: Validate inputs before use

P3.108 No Push Conflict/Auth Failure Distinction ► src/layers/GitLive.ts:58-75
  - Gap: Push maps all errors to generic GitError
  - Doesn't distinguish conflicts, auth failures, network issues
  - Impact: Cannot tell recoverable from unrecoverable errors
  - Fix: Parse git error output and categorize

P3.109 Silent Failure for Missing GITHUB_TOKEN ► src/layers/ConfigLive.ts:45-47
  - Gap: Missing token defaults to empty string with orElse
  - No logging or warning
  - Impact: Auth failures hard to trace to missing token
  - Fix: Add warning log when token missing

P3.110 No Git Root Directory Validation ► src/layers/ConfigLive.ts:50
  - Gap: Git root from command output used directly
  - Not validated as absolute path, existing directory, accessible
  - Impact: Unexpected output used without checks
  - Fix: Validate git root before use

### New P4 Items (Dashboard/UX)

P4.79 Iteration Metrics Type Never Defined ► specs/logging-telemetry.md:91-101
  - Gap: Spec defines IterationMetrics with token counts, context %
  - Interface doesn't exist in src/types.ts
  - Impact: Dashboard can't display iteration cards per spec
  - Fix: Define IterationMetrics interface

P4.80 iteration_start Event Type Never Emitted ► specs/logging-telemetry.md:72-77
  - Gap: Spec requires special event marking iteration boundaries
  - No code emits this event type
  - Impact: JSONL log parsing can't identify iteration starts
  - Fix: Add iteration_start event emission

P4.81 Prompt Display Missing from Dashboard ► specs/logging-telemetry.md:170-182
  - Gap: Spec shows prompt at top of activity panel
  - No component renders prompt, no event carries prompt content
  - Impact: Required dashboard feature missing
  - Fix: Add prompt display component

P4.82 Thinking Block Rendering Not Hidden ► specs/logging-telemetry.md:166-169
  - Gap: Thinking blocks should be hidden by default
  - No dashboard code hides them
  - Impact: Will render thinking text to users
  - Fix: Add toggle, default to hidden

P4.83 Subagent Tracker Interface Not Implemented ► specs/logging-telemetry.md:208-228
  - Gap: Spec defines SubagentTracker with startTime, endTime, result
  - Interface not defined anywhere
  - Impact: Dashboard can't show subagent activity
  - Fix: Implement SubagentTracker interface and tracking

P4.84 Missing /logs/:iteration Endpoint ► specs/logging-telemetry.md:281-284
  - Gap: Dashboard needs to fetch specific iteration logs
  - Endpoint doesn't exist in src/server.ts
  - Impact: Session recovery broken
  - Fix: Implement endpoint

P4.85 Missing /rerun Endpoint ► specs/logging-telemetry.md:245-254
  - Gap: Prompt editing requires rerun with modified prompt
  - Endpoint doesn't exist
  - Impact: Debugging workflow missing
  - Fix: Implement endpoint

P4.86 Missing /iterations Endpoint ► specs/logging-telemetry.md:274-280
  - Gap: Dashboard sidebar needs list of all iterations with metrics
  - Endpoint doesn't exist
  - Impact: Dashboard navigation broken
  - Fix: Implement endpoint

P4.87 No CORS Preflight Handling ► src/layers/DashboardLive.ts:115-176
  - Gap: Has Access-Control-Allow-Origin for SSE but no OPTIONS handler
  - Cross-origin preflight will fail
  - Impact: Dashboard may not work from different origin
  - Fix: Add OPTIONS handler for CORS preflight

P4.88 Missing Content-Type for Static Files ► src/layers/DashboardLive.ts:170-172
  - Gap: Static files served with Bun default content-type inference
  - Some extensions may get application/octet-stream
  - Impact: Files may not render correctly in browser
  - Fix: Explicit MIME type mapping

### New P5 Items (Consistency)

P5.89 Git Safe Directory Config Race ► src/program.ts:122-135, docker/entrypoint.sh:11
  - Gap: Entrypoint and program.ts both configure safe.directory
  - Unclear which wins, duplicate configuration
  - Impact: Configuration confusion
  - Fix: Configure in one place only

P5.90 No Structured Logging Across Layers ► src/layers/*.ts
  - Gap: None of the layer implementations have logging
  - No audit trail for operations
  - Impact: Difficult to diagnose issues in production
  - Fix: Add structured logging to all layers

P5.91 Inconsistent Error Context Preservation ► src/layers/*.ts
  - Gap: Some error mappings preserve full context, others lose info
  - ClaudeLive loses DockerError context, DockerLive preserves it
  - Impact: Inconsistent debugging experience
  - Fix: Standardize error context preservation

P5.92 No Metrics or Observability ► src/layers/*.ts
  - Gap: No metrics for operation latencies, error rates, resource usage
  - Impact: Cannot identify performance bottlenecks
  - Fix: Add metrics collection

P5.93 Inconsistent Error Message Styles ► src/layers/ConfigLive.ts:35-42,17-21
  - Gap: "Required environment variable not set" vs "Not in a git repository"
  - Different styles for similar errors
  - Impact: Inconsistent user experience
  - Fix: Standardize error message format

P5.94 Layer Dependency Comment Mismatch ► src/layers/index.ts:19-20
  - Gap: Comment says DockerLive depends on ConfigService
  - DockerLive doesn't actually depend on ConfigService
  - Impact: Misleading documentation
  - Fix: Update comment to match reality

P5.95 Hardcoded Timeout Mismatch ► src/layers/ConfigLive.ts:60, src/program.ts:244
  - Gap: Config timeout is 5 minutes, program uses 10 minutes
  - Inconsistent timeout configuration
  - Impact: ConfigService timeout not actually used
  - Fix: Unify timeout configuration

P5.96 No Validation of Layer Composition Parameters ► src/layers/index.ts:28-40
  - Gap: MainLive accepts containerName, cliArgs without validation
  - Empty strings, null values passed through
  - Impact: Invalid parameters cause confusing errors later
  - Fix: Validate parameters at composition time

### New P6 Items (Minor)

P6.80 Unnecessary Tools in Production Image ► docker/Dockerfile.base:16-30
  - Gap: Image includes curl, sudo, unzip after build
  - sudo should not be needed in production container
  - Impact: Increased attack surface
  - Fix: Use multi-stage build to remove unnecessary tools

P6.81 Missing USER Directive in Dockerfile ► docker/Dockerfile.base:63-78
  - Gap: Creates node user but never executes USER directive
  - Container runs as root by default
  - Impact: Relies on entrypoint to drop privileges
  - Fix: Add USER node directive after setup

P6.82 No Image Verification in Dockerfile ► docker/Dockerfile.base:33,47,55
  - Gap: Downloads GitHub CLI, Bun, Claude without checksum verification
  - curl | bash pattern is unsafe
  - Impact: Supply chain security risk
  - Fix: Add checksum verification for downloaded installers

P6.83 Type Safety Violation with 'as any' ► src/layers/DashboardLive.ts:63,188
  - Gap: Service implementation cast to any
  - Disables type checking for implementation
  - Impact: Type errors not caught at compile time
  - Fix: Fix type annotations to eliminate as any

P6.84 No tmpfs for Sensitive Data ► docker/entrypoint.sh:16-20
  - Gap: SSH keys copied to /tmp/.ssh regular filesystem
  - Keys persist in container layer
  - Impact: Keys may persist after session
  - Fix: Use tmpfs mount for sensitive temporary data

P6.85 Environment Variable Leakage ► docker/entrypoint.sh:31-33
  - Gap: GITHUB_TOKEN, OAUTH_TOKEN remain in env for all processes
  - Inherited by all child processes
  - Impact: Secrets may appear in error messages/logs
  - Fix: Unset env vars after configuration or use scoped credential approach

P6.86 No AppArmor/SELinux Configuration ► Docker configuration
  - Gap: No mandatory access control profiles specified
  - Impact: Missing defense-in-depth layer
  - Fix: Add AppArmor or SELinux profile configuration

P6.87 Firewall Verification Curl Timeout ► docker/init-firewall.sh:144-164
  - Gap: Uses --connect-timeout 5 for blocked domains
  - Blocked should fail instantly with REJECT
  - Impact: Slower startup, doesn't verify REJECT working
  - Fix: Use shorter timeout, verify immediate failure

### New P7 Items (Test Coverage)

P7.11 createSession Resume Path Untested ► src/program.ts:170-196
  - Gap: isResume vs new session logic has no tests
  - Impact: Resume flow may break silently
  - Fix: Add tests for both resume and new session paths

P7.12 Docker Argument Building Logic Untested ► src/layers/DockerLive.ts:42-81
  - Gap: Volume, env, capability flag construction untested
  - Impact: Argument building bugs undetected
  - Fix: Add unit tests for argument construction

P7.13 NDJSON Stream Parsing Integration Untested ► src/layers/ClaudeLive.ts:104-113
  - Gap: Parsing NDJSON from Docker exec stream untested
  - Impact: Stream parsing bugs undetected
  - Fix: Add integration tests with real NDJSON streams

P7.14 Timeout vs StreamError Discrimination Untested ► src/layers/ClaudeLive.ts:120-131
  - Gap: Error type discrimination logic untested
  - Impact: Wrong error types may be returned
  - Fix: Add tests for each error type case

P7.15 Git Branch Extraction Untested ► src/layers/GitLive.ts:80-91
  - Gap: git branch --show-current parsing untested
  - Impact: Branch extraction bugs undetected
  - Fix: Add tests for various git branch outputs

P7.16 Unpushed Commit Detection Untested ► src/layers/GitLive.ts:94-109
  - Gap: git log rev-list parsing untested
  - Impact: Incorrect unpushed detection
  - Fix: Add tests for various commit states

P7.17 SSE Client Tracking Untested ► src/layers/DashboardLive.ts:127-153
  - Gap: Client add/remove lifecycle untested
  - Impact: Client tracking bugs undetected
  - Fix: Add tests for client lifecycle

P7.18 Bun.serve Configuration Untested ► src/layers/DashboardLive.ts:113-179
  - Gap: Server configuration and startup untested
  - Impact: Server startup bugs undetected
  - Fix: Add integration tests for server lifecycle

P7.19 HTTP Endpoint Handlers Untested ► src/server.ts:235-281
  - Gap: pause, resume, step-mode, stop handlers untested
  - Impact: Endpoint bugs undetected
  - Fix: Add HTTP handler tests

P7.20 Static File Serving Untested ► src/server.ts:294-295
  - Gap: File serving and MIME type logic untested
  - Impact: File serving bugs undetected
  - Fix: Add static file serving tests

---

Iteration 27 Dependency Graph:
P1.321-326 Firewall/Entrypoint ─────────► Container security
P1.327-329 Session/State ───────────────► Core orchestration
P1.330 Type Safety ─────────────────────► Stream reliability
P1.331-333 Command Injection ───────────► Security critical
P1.334-337 Container Security ──────────► Defense in depth
P1.338-340 Resources/Paths ─────────────► Reliability

P2.132-144 Layer Architecture ──────────► Code quality
P3.99-110 Robustness ───────────────────► Reliability
P4.79-88 Dashboard ─────────────────────► User experience
P5.89-96 Consistency ───────────────────► Maintainability
P6.80-87 Minor Security ────────────────► Hardening
P7.11-20 Test Coverage ─────────────────► Quality assurance

Summary (Iteration 27):
- 20 new P1 items (P1.321-P1.340) - Security, firewall, type safety
- 13 new P2 items (P2.132-P2.144) - Architecture issues
- 12 new P3 items (P3.99-P3.110) - Robustness improvements
- 10 new P4 items (P4.79-P4.88) - Dashboard/UX gaps
- 8 new P5 items (P5.89-P5.96) - Consistency issues
- 8 new P6 items (P6.80-P6.87) - Minor security/polish
- 10 new P7 items (P7.11-P7.20) - Test coverage
- Total new items: 81

Running totals:
- P1 items: 340 (was 320)
- P2 items: 144 (was 131)
- P3 items: 110 (was 98)
- P4 items: 88 (was 78)
- P5 items: 96 (was 88)
- P6 items: 87 (was 79)
- P7 items: 20 (was 10)
- Grand total: 885 items (was 804)
