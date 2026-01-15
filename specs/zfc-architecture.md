# Zero Framework Cognition (ZFC) Architecture

**Purpose**: Architectural principle ensuring Ralph remains a thin orchestration layer that delegates ALL reasoning to AI models
**Origin**: [Steve Yegge's ZFC principles](https://steve-yegge.medium.com/zero-framework-cognition-a-way-to-build-resilient-ai-applications-56b090ed3e69)

## Core Principle

> Build a "thin, safe, deterministic shell" around AI reasoning with strong guardrails and observability.

Ralph is **pure orchestration** that delegates ALL cognitive reasoning to Claude. The framework handles IO, plumbing, safety checks, and policy enforcement. Claude handles all decisions.

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Dumb Pipes)                     │
│  - Read/write files                                              │
│  - Execute Docker commands                                       │
│  - Parse structured JSON                                         │
│  - Enforce timeouts and policies                                 │
│  - Track iteration state                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Delegates decisions
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE (Smart Endpoint)                     │
│  - Which feature to implement                                    │
│  - How to implement the feature                                  │
│  - Whether tests pass                                            │
│  - When to commit                                                │
│  - What commit message to use                                    │
│  - Whether to retry or move on                                   │
└─────────────────────────────────────────────────────────────────┘
```

## ZFC-Compliant Operations (Allowed)

### Pure Orchestration

**IO and Plumbing**
- Read/write files via `DockerService.readFile()`, `DockerService.exec()`
- Parse JSON, serialize/deserialize structured data
- Watch events, stream output via Effect Stream

**Structural Safety Checks**
- Schema validation (JSON structure, required fields)
- Path traversal prevention
- Timeout enforcement via `Effect.timeout()`
- Cancellation handling via Effect interruption

**Policy Enforcement**
- Budget caps (max iterations)
- Rate limits (circuit breaker after 3 no-change iterations)
- Confidence thresholds (exit codes from verify commands)
- Approval gates (step mode pause)

**Mechanical Transforms**
- Parameter substitution in prompts
- CLI argument parsing
- Formatting and rendering AI-provided data
- NDJSON stream parsing

**State Management**
- Lifecycle tracking (iteration count, container status)
- Progress monitoring (features remaining)
- Mission journaling (dashboard state)

**Typed Error Handling**
- Use `_tag` discriminated unions
- Handle via `Effect.catchTag()`
- Avoid message parsing for decisions

## ZFC-Violations (Forbidden)

### Local Intelligence/Reasoning

**Ranking/Scoring/Selection**
```typescript
// ❌ VIOLATION: Choosing based on heuristics
const nextFeature = features.sort((a, b) =>
  estimateComplexity(a) - estimateComplexity(b)
)[0]

// ✅ COMPLIANT: Let Claude choose
// Claude reads features.json and selects ONE feature
```

**Semantic Analysis**
```typescript
// ❌ VIOLATION: Inferring meaning from text
if (output.includes('error') || output.includes('failed')) {
  handleFailure()
}

// ✅ COMPLIANT: Check exit codes, not content
if (exitCode !== 0) {
  handleFailure()
}
```

**Heuristic Classification**
```typescript
// ❌ VIOLATION: Keyword-based routing
if (message.match(/done|complete|finished/i)) {
  markComplete()
}

// ✅ COMPLIANT: Claude updates structured data
// Claude sets passes: true in features.json
```

**Quality Judgment**
```typescript
// ❌ VIOLATION: Opinionated validation
if (codeQualityScore(diff) < 0.8) {
  rejectCommit()
}

// ✅ COMPLIANT: Structural validation only
if (!isValidJSON(featuresContent)) {
  throw new FeatureError({ message: 'Invalid JSON' })
}
```

## ZFC-Compliant Pattern

The correct flow for Ralph:

```
1. Gather Raw Context (IO only)
   └─ Read features.json from container
   └─ Get container status
   └─ Read environment configuration

2. Call AI for Decisions
   └─ Claude reads features.json
   └─ Claude selects which feature to implement
   └─ Claude decides implementation approach
   └─ Claude determines if verification passed

3. Validate Structure
   └─ JSON schema conformance
   └─ Required fields present
   └─ Exit code is 0 or non-0

4. Execute Mechanically
   └─ Run Docker commands
   └─ Push git commits
   └─ Update dashboard state
```

## Ralph's ZFC Implementation

### Feature Selection
```typescript
// ✅ COMPLIANT: Structural filter, Claude selects
function getRemainingFeatures(featuresJson: string): Feature[] {
  const data = JSON.parse(featuresJson)
  return data.features.filter((f: Feature) => !f.passes)  // Boolean check only
}
// Claude receives the list and chooses which one to work on
```

### Git Change Detection
```typescript
// ✅ COMPLIANT: Structural check
const output = yield* docker.exec(containerName, `git log origin/${branch}..HEAD --oneline`)
return output.trim().length > 0  // Length check, not content analysis
```

### Circuit Breaker
```typescript
// ✅ COMPLIANT: Policy enforcement via counting
if (state.noChangeCount >= 3) {
  return yield* Effect.fail(new CircuitBreakerError({
    iterations: state.iteration,
    reason: `No git changes pushed for ${state.noChangeCount} consecutive iterations`
  }))
}
```

### Error Handling
```typescript
// ✅ COMPLIANT: Typed error handling
yield* effect.pipe(
  Effect.catchTag("TimeoutError", (e) => /* handle timeout */),
  Effect.catchTag("DockerError", (e) => /* handle docker failure */)
)
```

## Anti-Patterns to Avoid

### Pattern Matching on AI Output

```typescript
// ❌ Never do this
const claudeOutput = await runClaude()
if (claudeOutput.includes('I have completed')) {
  markDone()
}

// ✅ Instead, have Claude update structured data
// Claude writes { "passes": true } to features.json
// Orchestrator reads the boolean value
```

### Keyword-Based Routing

```typescript
// ❌ Never do this
const errorKeywords = ['error', 'failed', 'exception', 'bug']
if (errorKeywords.some(k => output.toLowerCase().includes(k))) {
  handleError()
}

// ✅ Instead, use exit codes or structured responses
if (exitCode !== 0) {
  handleError()
}
```

### Complexity Estimation

```typescript
// ❌ Never do this
function estimateFeatureComplexity(feature: Feature): number {
  if (feature.description.includes('refactor')) return 3
  if (feature.description.includes('add')) return 1
  return 2
}

// ✅ Instead, let Claude assess complexity
// Claude reads the features and decides based on its understanding
```

### Output Summarization

```typescript
// ❌ Never do this
function summarizeClaudeOutput(events: ClaudeEvent[]): string {
  const errors = events.filter(e => e.type === 'error')
  const tools = events.filter(e => e.type === 'tool_use')
  return `Errors: ${errors.length}, Tools used: ${tools.length}`
}

// ✅ Instead, pass raw data to dashboard
// Let the human or another AI interpret it
```

## Cost Optimization with ZFC

ZFC doesn't mean expensive. Use model tiering:

| Task Type | Model Tier | Example |
|-----------|------------|---------|
| Complex reasoning | High (Opus) | Feature implementation |
| Simple checks | Medium (Sonnet) | Verification commands |
| Routing/classification | Low (Haiku) | If AI-based routing needed |

Ralph currently uses a single model (Claude Code CLI) for all operations. Future optimization could use cheaper models for status checks while reserving the primary model for implementation work.

## Compliance Checklist

When adding new code to Ralph, ask:

1. **Is this making a decision based on content?**
   - If yes, delegate to Claude instead

2. **Am I parsing text to determine next steps?**
   - If yes, use structured data or exit codes instead

3. **Am I adding keywords or patterns to match?**
   - If yes, this is a ZFC violation

4. **Am I estimating, ranking, or scoring?**
   - If yes, delegate to Claude instead

5. **Is this structural validation or semantic analysis?**
   - Structural (JSON schema, required fields) = OK
   - Semantic (meaning, quality, intent) = Violation

## Related Documentation

- [Orchestrator Spec](./orchestrator.md) - Main loop implementation
- [Features Spec](./features.md) - How Claude signals completion via structured data
- [Claude Integration Spec](./claude-integration.md) - How we invoke Claude
- Martin Fowler's "Smart Endpoints and Dumb Pipes" (microservices pattern)
- Andrej Karpathy's "Software 2.0" (models replacing code)
