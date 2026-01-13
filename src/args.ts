// Argument parsing for Ralph orchestrator

export interface RalphArgs {
  featuresPath: string
  branch?: string
  once: boolean
  maxIterations: number
  dashboard: boolean
  dashboardPort: number
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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) {
      branch = args[++i]
    } else if (args[i] === "--once") {
      once = true
    } else if (args[i] === "--max-iterations" && args[i + 1]) {
      maxIterations = parseInt(args[++i], 10)
    } else if (args[i] === "--dashboard") {
      dashboard = true
    } else if (args[i] === "--dashboard-port" && args[i + 1]) {
      dashboardPort = parseInt(args[++i], 10)
    } else if (!args[i].startsWith("--")) {
      featuresPath = args[i]
    }
  }
  return { featuresPath, branch, once, maxIterations, dashboard, dashboardPort }
}
