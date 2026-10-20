import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, resolveAgentDir, resolveSettingsPath, SettingsManager } from "../src/settings.js";

const TEST_DIR = join(import.meta.dir, ".tmp-settings-test");

describe("SettingsManager & Path Resolution", () => {
  const originalEnv = process.env.PI_CODING_AGENT_DIR;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = TEST_DIR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("resolves agent dir from PI_CODING_AGENT_DIR environment variable", () => {
    expect(resolveAgentDir()).toBe(TEST_DIR);
  });

  it("resolves settings path inside extensions folder", () => {
    const expectedPath = join(TEST_DIR, "extensions", "pi-usage.json");
    expect(resolveSettingsPath()).toBe(expectedPath);
  });

  it("automatically migrates legacy <agentDir>/pi-usage.json to extensions/pi-usage.json", () => {
    const legacyPath = join(TEST_DIR, "pi-usage.json");
    const extensionsPath = join(TEST_DIR, "extensions", "pi-usage.json");

    writeFileSync(legacyPath, JSON.stringify({ footerFormat: "multi-window", footerMetric: "remaining" }), "utf-8");

    const resolved = resolveSettingsPath();
    expect(resolved).toBe(extensionsPath);
    expect(existsSync(extensionsPath)).toBe(true);

    const migrated = JSON.parse(readFileSync(extensionsPath, "utf-8"));
    expect(migrated.footerFormat).toBe("multi-window");
    expect(migrated.footerMetric).toBe("remaining");
  });

  it("loads defaults when no settings file exists", () => {
    const manager = new SettingsManager();
    expect(manager.get()).toEqual(DEFAULT_SETTINGS);
    expect(manager.getFilePath()).toBe(join(TEST_DIR, "extensions", "pi-usage.json"));
  });

  it("updates and persists settings to extensions path", async () => {
    const manager = new SettingsManager();
    await manager.update({ footerFormat: "bar", footerMetric: "remaining" });

    expect(manager.get().footerFormat).toBe("bar");
    expect(manager.get().footerMetric).toBe("remaining");

    const onDisk = JSON.parse(readFileSync(manager.getFilePath(), "utf-8"));
    expect(onDisk.footerFormat).toBe("bar");
    expect(onDisk.footerMetric).toBe("remaining");
  });
});
