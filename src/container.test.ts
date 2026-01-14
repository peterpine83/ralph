import { describe, expect, test } from "bun:test"
import {
  generateBranchName,
  generateContainerName,
  parseStaleContainers,
  parseContainerRunning,
  getRemainingFeatures,
  hasUnpushedCommits,
} from "./container"

describe("generateBranchName", () => {
  test("generates branch name with correct format", () => {
    const name = generateBranchName()
    // Format: ralph/jan14-1430-a1b2
    expect(name).toMatch(/^ralph\/[a-z]{3}\d{2}-\d{4}-[a-z0-9]{4}$/)
  })

  test("starts with ralph/ prefix", () => {
    const name = generateBranchName()
    expect(name.startsWith("ralph/")).toBe(true)
  })

  test("contains valid month abbreviation", () => {
    const name = generateBranchName()
    const validMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    const monthPart = name.split("/")[1]!.substring(0, 3)
    expect(validMonths).toContain(monthPart)
  })

  test("generates unique names on successive calls", () => {
    const names = new Set<string>()
    for (let i = 0; i < 10; i++) {
      names.add(generateBranchName())
    }
    // Random suffix should make names unique
    expect(names.size).toBe(10)
  })
})

describe("generateContainerName", () => {
  test("generates name with custom session ID", () => {
    const name = generateContainerName("test-123")
    expect(name).toBe("ralph-session-test-123")
  })

  test("generates unique name without session ID", () => {
    const name = generateContainerName()
    expect(name).toMatch(/^ralph-session-ralph-\d+$/)
    expect(name.startsWith("ralph-session-")).toBe(true)
  })
})

describe("parseStaleContainers", () => {
  test("parses container names from docker ps output", () => {
    const output = "ralph-session-123\nralph-session-456\nralph-session-789\n"
    const result = parseStaleContainers(output)
    expect(result).toEqual(["ralph-session-123", "ralph-session-456", "ralph-session-789"])
  })

  test("handles empty output", () => {
    const result = parseStaleContainers("")
    expect(result).toEqual([])
  })

  test("handles whitespace-only output", () => {
    const result = parseStaleContainers("   \n   \n")
    expect(result).toEqual([])
  })

  test("handles single container", () => {
    const result = parseStaleContainers("ralph-session-single")
    expect(result).toEqual(["ralph-session-single"])
  })
})

describe("parseContainerRunning", () => {
  test("returns true for 'true' output", () => {
    expect(parseContainerRunning("true")).toBe(true)
    expect(parseContainerRunning("true\n")).toBe(true)
    expect(parseContainerRunning("  true  ")).toBe(true)
  })

  test("returns false for 'false' output", () => {
    expect(parseContainerRunning("false")).toBe(false)
    expect(parseContainerRunning("false\n")).toBe(false)
  })

  test("returns false for other output", () => {
    expect(parseContainerRunning("")).toBe(false)
    expect(parseContainerRunning("error")).toBe(false)
    expect(parseContainerRunning("True")).toBe(false)
  })
})

describe("getRemainingFeatures", () => {
  test("returns features where passes is false", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: true },
        { id: "feat-2", passes: false },
        { id: "feat-3", passes: false },
        { id: "feat-4", passes: true },
      ]
    })
    const result = getRemainingFeatures(json)
    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe("feat-2")
    expect(result[1]!.id).toBe("feat-3")
  })

  test("returns empty array when all features pass", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: true },
        { id: "feat-2", passes: true },
      ]
    })
    const result = getRemainingFeatures(json)
    expect(result).toHaveLength(0)
  })

  test("returns all features when none pass", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: false },
        { id: "feat-2", passes: false },
      ]
    })
    const result = getRemainingFeatures(json)
    expect(result).toHaveLength(2)
  })

  test("handles empty features array", () => {
    const json = JSON.stringify({ features: [] })
    const result = getRemainingFeatures(json)
    expect(result).toHaveLength(0)
  })
})

describe("hasUnpushedCommits", () => {
  test("returns true when commits exist", () => {
    expect(hasUnpushedCommits("abc123 Some commit")).toBe(true)
    expect(hasUnpushedCommits("abc123 First\ndef456 Second")).toBe(true)
  })

  test("returns false for empty output", () => {
    expect(hasUnpushedCommits("")).toBe(false)
    expect(hasUnpushedCommits("   ")).toBe(false)
    expect(hasUnpushedCommits("\n")).toBe(false)
  })
})
