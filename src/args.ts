// Argument parsing for Ralph orchestrator

export interface RalphArgs {
  featuresPath: string
  branch?: string
  once: boolean
  maxIterations: number
  dashboard: boolean
  dashboardPort: number
  step: boolean
}

const DEFAULT_MAX_ITERATIONS = 5
const DEFAULT_DASHBOARD_PORT = 3847

export function parseArgs(args: string[]): RalphArgs {
  let featuresPath = "features.json"
  let branch: string | undefined
  let once = false
  let maxIterations = DEFAULT_MAX_ITERATIONS
  let dashboard = false
  let dashboardPort = DEFAULT_DASHBOARD_PORT
  let step = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]
    if (arg === "--branch" && nextArg) {
      branch = nextArg
      i++
    } else if (arg === "--once") {
      once = true
    } else if (arg === "--max-iterations" && nextArg) {
      maxIterations = parseInt(nextArg, 10)
      i++
    } else if (arg === "--dashboard") {
      dashboard = true
    } else if (arg === "--step") {
      step = true
    } else if (arg === "--dashboard-port" && nextArg) {
      dashboardPort = parseInt(nextArg, 10)
      i++
    } else if (arg && !arg.startsWith("--")) {
      featuresPath = arg
    }
  }
  return { featuresPath, branch, once, maxIterations, dashboard, dashboardPort, step }
}
