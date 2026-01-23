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

### Priority Summary (Updated Jan 2026 - Iteration 9)
| Priority | Category | Items | Status |
|----------|----------|-------|--------|
| P1 | Critical Integration | 126 items | Blocking basic functionality (includes 5 CRITICAL security: P1.49, P1.81, P1.82, P1.118, P1.119; 3 verified complete; 9 new items from iteration 9) |
| P2 | Dashboard Integration | 33 items | Core UX features (3 new from iteration 9: CORS, backpressure, silent catch) |
| P3 | Missing Functionality | 23 items | Logging/telemetry subsystem + streaming (2 new: service interface, layer) |
| P4 | Robustness | 20 items | Production readiness (2 new: container start timeout, session ID collision) |
| P5 | Test Coverage | 22 items | Quality assurance (2 new: stale containers parsing, branch param) |
| P6 | Dashboard & Streaming Integration | 33 items | Event streaming, state sync, lifecycle (6 new patterns from ralph.ts) |
| **Total** | | **257 items** | ~35% complete |

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
```
