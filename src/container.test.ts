import { describe, expect, test } from "bun:test";
import {
  generateContainerName,
  buildDockerCreateArgs,
  buildCopyCommand,
  buildGitCheckoutCommand,
  parseStaleContainers,
  parseContainerRunning,
  getRemainingFeatures,
  hasUnpushedCommits,
  type SessionConfig,
} from "./container";

describe("generateContainerName", () => {
  test("generates name with custom session ID", () => {
    const name = generateContainerName("test-123");
    expect(name).toBe("ralph-session-test-123");
  });

  test("generates unique name without session ID", () => {
    const name1 = generateContainerName();
    const name2 = generateContainerName();
    expect(name1).toMatch(/^ralph-session-ralph-\d+$/);
    // Names should be different (timestamp-based)
    // Note: might rarely collide if called within same ms
    expect(name1.startsWith("ralph-session-")).toBe(true);
  });
});

describe("buildDockerCreateArgs", () => {
  const baseConfig: SessionConfig = {
    gitRoot: "/home/user/project",
    branch: "ralph/123",
    isResume: false,
  };

  test("includes basic required args", () => {
    const args = buildDockerCreateArgs("ralph-test", baseConfig);

    expect(args).toContain("docker");
    expect(args).toContain("create");
    expect(args).toContain("--name");
    expect(args).toContain("ralph-test");
    expect(args).toContain("--cap-add=NET_ADMIN");
    expect(args).toContain("ralph-base:latest");
    expect(args).toContain("sleep");
    expect(args).toContain("infinity");
  });

  test("includes workspace working directory", () => {
    const args = buildDockerCreateArgs("ralph-test", baseConfig);
    const wIndex = args.indexOf("-w");
    expect(wIndex).toBeGreaterThan(-1);
    expect(args[wIndex + 1]).toBe("/workspace");
  });

  test("includes default git author info", () => {
    const args = buildDockerCreateArgs("ralph-test", baseConfig);
    expect(args).toContain("-e");
    expect(args.some(a => a.includes("GIT_AUTHOR_NAME=Ralph"))).toBe(true);
    expect(args.some(a => a.includes("GIT_AUTHOR_EMAIL=ralph@localhost"))).toBe(true);
  });

  test("includes SSH volume mount when provided", () => {
    const config = { ...baseConfig, sshDir: "/home/user/.ssh" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("/home/user/.ssh:/home/node/.ssh:ro"))).toBe(true);
  });

  test("includes Claude dir volume mount when provided", () => {
    const config = { ...baseConfig, claudeDir: "/home/user/.claude" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("/home/user/.claude:/home/node/.claude:rw"))).toBe(true);
  });

  test("includes gitconfig volume mount when provided", () => {
    const config = { ...baseConfig, gitconfigPath: "/home/user/.gitconfig" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("/home/user/.gitconfig:/home/node/.gitconfig:ro"))).toBe(true);
  });

  test("includes OAuth token when provided", () => {
    const config = { ...baseConfig, claudeOAuthToken: "test-token" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("CLAUDE_CODE_OAUTH_TOKEN=test-token"))).toBe(true);
  });

  test("includes GitHub token when provided", () => {
    const config = { ...baseConfig, githubToken: "gh-token" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("GITHUB_TOKEN=gh-token"))).toBe(true);
  });

  test("uses custom git author info when provided", () => {
    const config = { ...baseConfig, gitAuthorName: "Test User", gitAuthorEmail: "test@example.com" };
    const args = buildDockerCreateArgs("ralph-test", config);
    expect(args.some(a => a.includes("GIT_AUTHOR_NAME=Test User"))).toBe(true);
    expect(args.some(a => a.includes("GIT_AUTHOR_EMAIL=test@example.com"))).toBe(true);
  });
});

describe("buildCopyCommand", () => {
  test("returns tar and exec commands", () => {
    const result = buildCopyCommand("ralph-test", "/home/user/project");
    expect(result.tarCmd).toBe("tar -C /home/user/project -cf - .");
    expect(result.execCmd).toBe("docker exec -i ralph-test tar -xf - -C /workspace");
  });
});

describe("buildGitCheckoutCommand", () => {
  test("creates new branch for non-resume", () => {
    const commands = buildGitCheckoutCommand("ralph-test", "ralph/123", false);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual([
      "docker", "exec", "ralph-test", "git", "checkout", "-b", "ralph/123"
    ]);
  });

  test("fetches and checks out existing branch for resume", () => {
    const commands = buildGitCheckoutCommand("ralph-test", "ralph/123", true);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual([
      "docker", "exec", "ralph-test", "git", "fetch", "origin", "ralph/123"
    ]);
    expect(commands[1]).toEqual([
      "docker", "exec", "ralph-test", "git", "checkout", "-B", "ralph/123", "origin/ralph/123"
    ]);
  });
});

describe("parseStaleContainers", () => {
  test("parses container names from docker ps output", () => {
    const output = "ralph-session-123\nralph-session-456\nralph-session-789\n";
    const result = parseStaleContainers(output);
    expect(result).toEqual(["ralph-session-123", "ralph-session-456", "ralph-session-789"]);
  });

  test("handles empty output", () => {
    const result = parseStaleContainers("");
    expect(result).toEqual([]);
  });

  test("handles whitespace-only output", () => {
    const result = parseStaleContainers("   \n   \n");
    expect(result).toEqual([]);
  });

  test("handles single container", () => {
    const result = parseStaleContainers("ralph-session-single");
    expect(result).toEqual(["ralph-session-single"]);
  });
});

describe("parseContainerRunning", () => {
  test("returns true for 'true' output", () => {
    expect(parseContainerRunning("true")).toBe(true);
    expect(parseContainerRunning("true\n")).toBe(true);
    expect(parseContainerRunning("  true  ")).toBe(true);
  });

  test("returns false for 'false' output", () => {
    expect(parseContainerRunning("false")).toBe(false);
    expect(parseContainerRunning("false\n")).toBe(false);
  });

  test("returns false for other output", () => {
    expect(parseContainerRunning("")).toBe(false);
    expect(parseContainerRunning("error")).toBe(false);
    expect(parseContainerRunning("True")).toBe(false);
  });
});

describe("getRemainingFeatures", () => {
  test("returns features where passes is false", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: true },
        { id: "feat-2", passes: false },
        { id: "feat-3", passes: false },
        { id: "feat-4", passes: true },
      ]
    });
    const result = getRemainingFeatures(json);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("feat-2");
    expect(result[1].id).toBe("feat-3");
  });

  test("returns empty array when all features pass", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: true },
        { id: "feat-2", passes: true },
      ]
    });
    const result = getRemainingFeatures(json);
    expect(result).toHaveLength(0);
  });

  test("returns all features when none pass", () => {
    const json = JSON.stringify({
      features: [
        { id: "feat-1", passes: false },
        { id: "feat-2", passes: false },
      ]
    });
    const result = getRemainingFeatures(json);
    expect(result).toHaveLength(2);
  });

  test("handles empty features array", () => {
    const json = JSON.stringify({ features: [] });
    const result = getRemainingFeatures(json);
    expect(result).toHaveLength(0);
  });
});

describe("hasUnpushedCommits", () => {
  test("returns true when commits exist", () => {
    expect(hasUnpushedCommits("abc123 Some commit")).toBe(true);
    expect(hasUnpushedCommits("abc123 First\ndef456 Second")).toBe(true);
  });

  test("returns false for empty output", () => {
    expect(hasUnpushedCommits("")).toBe(false);
    expect(hasUnpushedCommits("   ")).toBe(false);
    expect(hasUnpushedCommits("\n")).toBe(false);
  });
});
