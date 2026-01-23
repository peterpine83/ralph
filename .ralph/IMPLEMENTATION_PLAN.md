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

### Implementation Completeness Update (Jan 2026 - Iteration 2)
Based on extended gap analysis and verification of implemented items:
- **Effect implementation is ~35-40% complete**
- **Verified complete**: P1.23, P1.26, P1.28, P1.37 (git config, clone pattern, keep-alive)
- **P1 items: 60** (63 - 3 verified complete)
- **P2 items: 16**
- **P3 items: 15**
- **P4 items: 10**
- **P5 items: 12**
- **P6 items: 27** (NEW - dashboard & streaming integration)
- **Total items: 140** (116 + 27 new - 3 verified complete)
- Security issues tracked: P1.49 (CRITICAL), P1.62 (cap-drop)
- Critical fix needed: P6.9 (listByPrefix searches filesystem, not Docker daemon)

### Items Already Implemented in Entrypoint/Firewall
The following are implemented in docker/entrypoint.sh and docker/init-firewall.sh:
- SSH key copying from `/root/.ssh` to `/tmp/.ssh/` with 700/600 permissions
- Git safe.directory configuration
- Docker DNS preservation during firewall init
- Firewall self-verification tests (blocked + allowed domains)
- GitHub IP CIDR aggregation via `aggregate` tool
- Host network auto-detection and whitelisting
These exist but weren't tracked in the plan - they work correctly.

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

### Priority Summary (Updated Jan 2026 - Iteration 3)
| Priority | Category | Items | Status |
|----------|----------|-------|--------|
| P1 | Critical Integration | 66 items | Blocking basic functionality (includes 1 CRITICAL security, 3 verified complete, 3 new items) |
| P2 | Dashboard Integration | 16 items | Core UX features |
| P3 | Missing Functionality | 15 items | Logging/telemetry subsystem + streaming |
| P4 | Robustness | 10 items | Production readiness |
| P5 | Test Coverage | 12 items | Quality assurance (P5.9 duplicate of P5.2) |
| P6 | Dashboard & Streaming Integration | 27 items | Event streaming, state sync, lifecycle |
| **Total** | | **146 items** | ~35-40% complete |

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
```
