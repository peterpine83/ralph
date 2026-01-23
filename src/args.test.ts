import { describe, expect, test } from "bun:test"
import { parseArgs } from "./args"

describe("parseArgs", () => {
  test("returns defaults when no args provided", () => {
    const result = parseArgs([])
    expect(result).toEqual({
      featuresPath: ".ralph/features.json",
      branch: undefined,
      once: false,
      maxIterations: 50,
      dashboard: false,
      dashboardPort: 3847,
      step: false,
      mode: "build",
    })
  })

  test("parses custom features path (positional arg)", () => {
    const result = parseArgs(["my-features.json"])
    expect(result.featuresPath).toBe("my-features.json")
  })

  test("parses --branch flag", () => {
    const result = parseArgs(["--branch", "ralph/123"])
    expect(result.branch).toBe("ralph/123")
  })

  test("parses --once flag", () => {
    const result = parseArgs(["--once"])
    expect(result.once).toBe(true)
  })

  test("parses --max-iterations flag", () => {
    const result = parseArgs(["--max-iterations", "10"])
    expect(result.maxIterations).toBe(10)
  })

  test("parses all flags together", () => {
    const result = parseArgs([
      "custom.json",
      "--branch", "ralph/feature-branch",
      "--once",
      "--max-iterations", "20",
    ])
    expect(result).toEqual({
      featuresPath: "custom.json",
      branch: "ralph/feature-branch",
      once: true,
      maxIterations: 20,
      dashboard: false,
      dashboardPort: 3847,
      step: false,
      mode: "build",
    })
  })

  test("handles flags in any order", () => {
    const result = parseArgs([
      "--once",
      "--max-iterations", "3",
      "features.json",
      "--branch", "my-branch",
    ])
    expect(result).toEqual({
      featuresPath: "features.json",
      branch: "my-branch",
      once: true,
      maxIterations: 3,
      dashboard: false,
      dashboardPort: 3847,
      step: false,
      mode: "build",
    })
  })

  test("ignores --branch without value", () => {
    const result = parseArgs(["--branch"])
    expect(result.branch).toBeUndefined()
  })

  test("ignores --max-iterations without value", () => {
    const result = parseArgs(["--max-iterations"])
    expect(result.maxIterations).toBe(50) // default
  })

  test("parses NaN max-iterations as NaN", () => {
    const result = parseArgs(["--max-iterations", "not-a-number"])
    expect(result.maxIterations).toBeNaN()
  })

  test("parses --dashboard flag", () => {
    const result = parseArgs(["--dashboard"])
    expect(result.dashboard).toBe(true)
  })

  test("parses --dashboard-port flag", () => {
    const result = parseArgs(["--dashboard-port", "8080"])
    expect(result.dashboardPort).toBe(8080)
  })

  test("parses dashboard flags together", () => {
    const result = parseArgs(["--dashboard", "--dashboard-port", "9000"])
    expect(result.dashboard).toBe(true)
    expect(result.dashboardPort).toBe(9000)
  })

  test("parses --step flag", () => {
    const result = parseArgs(["--step"])
    expect(result.step).toBe(true)
  })

  test("parses --step with other flags", () => {
    const result = parseArgs(["--step", "--dashboard", "--once"])
    expect(result.step).toBe(true)
    expect(result.dashboard).toBe(true)
    expect(result.once).toBe(true)
  })

  test("parses --mode plan", () => {
    const result = parseArgs(["--mode", "plan"])
    expect(result.mode).toBe("plan")
  })

  test("parses --mode build", () => {
    const result = parseArgs(["--mode", "build"])
    expect(result.mode).toBe("build")
  })

  test("defaults to build mode when --mode not specified", () => {
    const result = parseArgs([])
    expect(result.mode).toBe("build")
  })

  test("ignores invalid --mode values", () => {
    const result = parseArgs(["--mode", "invalid"])
    expect(result.mode).toBe("build") // Should remain default
  })

  test("ignores --mode without value", () => {
    const result = parseArgs(["--mode"])
    expect(result.mode).toBe("build") // Should remain default
  })
})
