#!/usr/bin/env bun
// Demo script to showcase the dashboard UI with mock data

import {
  startDashboardServer,
  updateState,
  updateIteration,
  updateFeatures,
  sendOutput,
  setPromptTemplate,
} from "./src/server"

const RALPH_HOME = import.meta.dir
const dashboardPath = `${RALPH_HOME}/dashboard/dist/index.html`

// Mock features
const mockFeatures = [
  { id: "setup-001", description: "Initialize project structure", passes: true },
  { id: "setup-002", description: "Add authentication middleware", passes: true },
  { id: "feature-001", description: "Implement user login endpoint", passes: false },
  { id: "feature-002", description: "Add session management", passes: false },
  { id: "feature-003", description: "Create logout functionality", passes: false },
]

// Start dashboard
console.log("Starting Ralph Dashboard Demo...")
startDashboardServer(3847, dashboardPath)

// Initialize state
updateState({
  running: true,
  paused: false,
  containerName: "ralph-session-demo-123",
  branch: "ralph/demo-1736789012",
})

setPromptTemplate("# Ralph Instructions\n\nThis is a demo of the dashboard.")

updateFeatures(mockFeatures)
updateIteration(2, 5, 3)

// Simulate Claude output
const mockOutput = [
  "\x1b[36m● claude\x1b[0m Reading .ralph-prompt.md...\n",
  "\x1b[33m◐ Analyzing\x1b[0m features.json to find next task\n",
  "\n\x1b[1mSelected feature:\x1b[0m feature-001 - Implement user login endpoint\n\n",
  "\x1b[36m● Task\x1b[0m Exploring codebase for auth patterns...\n",
  "  \x1b[90m→ Found: src/middleware/auth.ts\x1b[0m\n",
  "  \x1b[90m→ Found: src/routes/api.ts\x1b[0m\n",
  "\n\x1b[36m● Read\x1b[0m src/middleware/auth.ts\n",
  "\x1b[90m   1│ import { Request, Response, NextFunction } from 'express'\x1b[0m\n",
  "\x1b[90m   2│ import { verifyToken } from '../utils/jwt'\x1b[0m\n",
  "\x1b[90m   3│ \x1b[0m\n",
  "\x1b[90m   4│ export async function authMiddleware(req: Request) {\x1b[0m\n",
  "\n\x1b[32m● Edit\x1b[0m src/routes/login.ts\n",
  "  \x1b[90mAdding login endpoint handler...\x1b[0m\n",
  "\n\x1b[34m● Bash\x1b[0m bun test\n",
  "\x1b[90m  Running tests...\x1b[0m\n",
  "\x1b[32m  ✓ auth middleware validates tokens\x1b[0m\n",
  "\x1b[32m  ✓ login endpoint returns JWT\x1b[0m\n",
  "\x1b[31m  ✗ login fails with invalid credentials\x1b[0m\n",
  "\n\x1b[33m● Fixing\x1b[0m test failure...\n",
]

// Stream mock output with delays
let i = 0
const interval = setInterval(() => {
  if (i < mockOutput.length) {
    sendOutput(mockOutput[i])
    i++
  } else {
    // Loop back for continuous demo
    i = 0
    sendOutput("\n\x1b[90m--- Demo loop restart ---\x1b[0m\n\n")
  }
}, 800)

console.log("\nDashboard running at: http://localhost:3847")
console.log("Press Ctrl+C to stop\n")

// Keep process alive
process.on("SIGINT", () => {
  clearInterval(interval)
  console.log("\nStopping demo...")
  process.exit(0)
})
