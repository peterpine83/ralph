// Argument parsing for Ralph orchestrator

export interface RalphArgs {
  featuresPath: string;
  branch?: string;
  once: boolean;
  maxIterations: number;
}

const DEFAULT_MAX_ITERATIONS = 5;

export function parseArgs(args: string[]): RalphArgs {
  let featuresPath = "features.json";
  let branch: string | undefined;
  let once = false;
  let maxIterations = DEFAULT_MAX_ITERATIONS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) {
      branch = args[++i];
    } else if (args[i] === "--once") {
      once = true;
    } else if (args[i] === "--max-iterations" && args[i + 1]) {
      maxIterations = parseInt(args[++i], 10);
    } else if (!args[i].startsWith("--")) {
      featuresPath = args[i];
    }
  }
  return { featuresPath, branch, once, maxIterations };
}
