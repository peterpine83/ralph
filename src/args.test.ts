import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  test("returns defaults when no args provided", () => {
    const result = parseArgs([]);
    expect(result).toEqual({
      featuresPath: "features.json",
      branch: undefined,
      once: false,
      maxIterations: 5,
    });
  });

  test("parses custom features path (positional arg)", () => {
    const result = parseArgs(["my-features.json"]);
    expect(result.featuresPath).toBe("my-features.json");
  });

  test("parses --branch flag", () => {
    const result = parseArgs(["--branch", "ralph/123"]);
    expect(result.branch).toBe("ralph/123");
  });

  test("parses --once flag", () => {
    const result = parseArgs(["--once"]);
    expect(result.once).toBe(true);
  });

  test("parses --max-iterations flag", () => {
    const result = parseArgs(["--max-iterations", "10"]);
    expect(result.maxIterations).toBe(10);
  });

  test("parses all flags together", () => {
    const result = parseArgs([
      "custom.json",
      "--branch", "ralph/feature-branch",
      "--once",
      "--max-iterations", "20",
    ]);
    expect(result).toEqual({
      featuresPath: "custom.json",
      branch: "ralph/feature-branch",
      once: true,
      maxIterations: 20,
    });
  });

  test("handles flags in any order", () => {
    const result = parseArgs([
      "--once",
      "--max-iterations", "3",
      "features.json",
      "--branch", "my-branch",
    ]);
    expect(result).toEqual({
      featuresPath: "features.json",
      branch: "my-branch",
      once: true,
      maxIterations: 3,
    });
  });

  test("ignores --branch without value", () => {
    const result = parseArgs(["--branch"]);
    expect(result.branch).toBeUndefined();
  });

  test("ignores --max-iterations without value", () => {
    const result = parseArgs(["--max-iterations"]);
    expect(result.maxIterations).toBe(5); // default
  });

  test("parses NaN max-iterations as NaN", () => {
    const result = parseArgs(["--max-iterations", "not-a-number"]);
    expect(result.maxIterations).toBeNaN();
  });
});
