# Features Specification

**File Format**: `.ralph/features.json`
**Purpose**: Define work items for Claude to implement, with verification commands

## Schema

```json
{
  "features": [
    {
      "id": "string (required)",
      "description": "string (required)",
      "passes": "boolean (required)",
      "verify_command": "string (optional)"
    }
  ]
}
```

## Field Definitions

### `id` (required)
Unique identifier for the feature. Used in commit messages and progress tracking.

**Conventions:**
- Use kebab-case or snake_case
- Include category prefix (e.g., `auth-001`, `ui-login`, `api-users`)
- Keep short but descriptive

**Examples:**
```json
"id": "setup-001"
"id": "auth-jwt-implementation"
"id": "api-user-endpoints"
```

### `description` (required)
User-story style description of the expected outcome. Describes **what**, not **how**.

**Guidelines:**
- Focus on observable behavior
- Include acceptance criteria
- Be specific enough for verification

**Examples:**
```json
"description": "Users can log in with email and password"
"description": "API returns paginated list of products with filtering"
"description": "Dashboard displays real-time metrics chart"
```

### `passes` (required)
Boolean indicating completion status.

| Value | Meaning |
|-------|---------|
| `false` | Feature not yet implemented (Claude will work on it) |
| `true` | Feature complete and verified (Claude skips it) |

**Workflow:**
1. Start with `passes: false`
2. Claude implements the feature
3. Claude runs full CI suite (typecheck, tests, build) — **mandatory**
4. If CI fails, Claude fixes issues and reruns CI
5. Claude runs `verify_command` (if present)
6. If ALL checks pass, Claude sets `passes: true`
7. Claude commits and pushes

**CI Gate:** Claude cannot mark `passes: true` or proceed to the next feature until CI passes. This ensures each feature leaves the codebase in a working state.

### `verify_command` (optional)
Bash command that exits 0 on success, non-zero on failure.

**Guidelines:**
- Keep commands simple and fast
- Use standard tools (test, grep, npm, etc.)
- Avoid interactive commands
- Multiple conditions can be chained with `&&`

**Examples:**
```json
"verify_command": "test -f package.json"
"verify_command": "npm test -- --grep 'auth'"
"verify_command": "curl -s localhost:3000/health | grep -q 'ok'"
"verify_command": "bun run typecheck && bun test"
```

## Complete Example

```json
{
  "features": [
    {
      "id": "setup-001",
      "description": "Initialize project with package.json and TypeScript config",
      "passes": true,
      "verify_command": "test -f package.json && test -f tsconfig.json"
    },
    {
      "id": "auth-001",
      "description": "Implement JWT authentication with login endpoint",
      "passes": false,
      "verify_command": "bun test src/auth.test.ts"
    },
    {
      "id": "auth-002",
      "description": "Add password reset flow with email verification",
      "passes": false,
      "verify_command": "bun test src/auth.test.ts --grep 'password reset'"
    },
    {
      "id": "api-001",
      "description": "Create CRUD endpoints for user management",
      "passes": false,
      "verify_command": "bun test src/api/users.test.ts"
    }
  ]
}
```

## Processing Pipeline

### 1. Read from Container
```bash
docker exec <container> cat /workspace/.ralph/features.json
```

### 2. Parse and Filter
```typescript
// src/container.ts
function getRemainingFeatures(featuresJson: string): Feature[] {
  const data = JSON.parse(featuresJson)
  return data.features.filter((f: Feature) => !f.passes)
}
```

### 3. Display Progress
```
Remaining features: 3/4
- auth-001: Implement JWT authentication...
- auth-002: Add password reset flow...
- api-001: Create CRUD endpoints...
```

### 4. Claude Selection
Claude reads features.json and selects ONE feature to implement per iteration. Selection criteria:
- Dependencies (implement prerequisites first)
- Complexity (start with foundational features)
- Verification command availability

### 5. Completion Check
When `getRemainingFeatures()` returns empty array:
- All features complete
- Orchestrator pushes final commit
- Loop exits successfully

## Claude's Feature Workflow

From `templates/ralph-instructions.md`:

```
1. Read .ralph/features.json to understand remaining work
2. Choose ONE feature to implement
3. Implement the feature
4. Run verify_command (if present)
5. If verification passes:
   - Set passes: true in .ralph/features.json
   - Commit: "Feature: {id} - {description}"
   - Push to branch
6. EXIT (don't continue to next feature)
```

## Best Practices

### Feature Granularity
```json
// TOO BROAD - hard to verify, long implementation
{
  "id": "auth",
  "description": "Add complete authentication system"
}

// BETTER - specific, verifiable units
{
  "id": "auth-001",
  "description": "Create User model with email/password fields"
},
{
  "id": "auth-002",
  "description": "Implement password hashing with bcrypt"
},
{
  "id": "auth-003",
  "description": "Add login endpoint returning JWT token"
}
```

### Verification Commands
```json
// GOOD - fast, deterministic
"verify_command": "test -f src/auth.ts && grep -q 'hashPassword' src/auth.ts"

// GOOD - runs actual tests
"verify_command": "bun test src/auth.test.ts"

// BAD - requires running server
"verify_command": "curl localhost:3000/login"

// BAD - interactive
"verify_command": "npm test -- --watch"
```

### Dependency Ordering
List features in dependency order:
```json
{
  "features": [
    { "id": "db-001", "description": "Set up database connection" },
    { "id": "db-002", "description": "Create User table schema" },
    { "id": "auth-001", "description": "Implement user registration" },
    { "id": "auth-002", "description": "Implement user login" }
  ]
}
```

## Type Definition

```typescript
// src/types.ts
interface Feature {
  id: string
  description: string
  passes: boolean
  verify_command?: string
}

interface FeaturesFile {
  features: Feature[]
}
```

## Error Cases

| Scenario | Behavior |
|----------|----------|
| File not found | Orchestrator exits with error |
| Invalid JSON | Orchestrator exits with error |
| Empty features array | Orchestrator exits (nothing to do) |
| Missing required field | Claude may fail to process |
| verify_command fails | Claude keeps `passes: false`, retries or moves on |
