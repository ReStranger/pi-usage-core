import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { UsageSettings } from "./types.js";

export const DEFAULT_SETTINGS: UsageSettings = {
  footerFormat: "percent",
  footerMetric: "used",
  pinnedTarget: null,
  refreshIntervalMinutes: 5,
  enableDevMock: false,
};

/**
 * Dynamically resolves the agent configuration directory.
 * Respects PI_CODING_AGENT_DIR environment variable if set,
 * falls back to SDK getAgentDir(), then XDG ~/.config/pi/agent and legacy ~/.pi/agent.
 */
export function resolveAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir && envDir.trim()) {
    const trimmed = envDir.trim();
    return trimmed.startsWith("~") ? trimmed.replace(/^~(?=$|\/|\\)/, homedir()) : trimmed;
  }

  try {
    const sdkDir = getAgentDir();
    if (sdkDir) return sdkDir;
  } catch {
    // ignore
  }

  const xdgDir = join(homedir(), ".config", "pi", "agent");
  if (existsSync(xdgDir)) {
    return xdgDir;
  }
  return join(homedir(), ".pi", "agent");
}

/**
 * Resolves the configuration path inside the extensions directory:
 * <agent-dir>/extensions/pi-usage.json
 * If a legacy <agent-dir>/pi-usage.json exists, automatically migrates it.
 */
export function resolveSettingsPath(): string {
  const agentDir = resolveAgentDir();
  const extensionsDir = join(agentDir, "extensions");
  const extensionsPath = join(extensionsDir, "pi-usage.json");
  const legacyPath = join(agentDir, "pi-usage.json");

  if (existsSync(extensionsPath)) {
    return extensionsPath;
  }

  if (existsSync(legacyPath)) {
    try {
      if (!existsSync(extensionsDir)) {
        mkdirSync(extensionsDir, { recursive: true });
      }
      const content = readFileSync(legacyPath, "utf-8");
      writeFileSync(extensionsPath, content, "utf-8");
      return extensionsPath;
    } catch {
      return legacyPath;
    }
  }

  return extensionsPath;
}

export class SettingsManager {
  private filePath: string;
  private settings: UsageSettings;

  constructor(customPath?: string) {
    this.filePath = customPath ?? resolveSettingsPath();
    this.settings = this.load();
  }

  getFilePath(): string {
    return this.filePath;
  }

  get(): Readonly<UsageSettings> {
    return this.settings;
  }

  async update(patch: Partial<UsageSettings>): Promise<UsageSettings> {
    this.settings = { ...this.settings, ...patch };
    await this.save(this.settings);
    return this.settings;
  }

  private load(): UsageSettings {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        footerFormat: ["percent", "with-reset", "multi-window", "bar"].includes(parsed.footerFormat)
          ? parsed.footerFormat
          : DEFAULT_SETTINGS.footerFormat,
        footerMetric: ["used", "remaining"].includes(parsed.footerMetric)
          ? parsed.footerMetric
          : DEFAULT_SETTINGS.footerMetric,
        pinnedTarget:
          parsed.pinnedTarget &&
          typeof parsed.pinnedTarget.providerId === "string" &&
          typeof parsed.pinnedTarget.accountId === "string"
            ? parsed.pinnedTarget
            : null,
        refreshIntervalMinutes:
          typeof parsed.refreshIntervalMinutes === "number" && parsed.refreshIntervalMinutes > 0
            ? parsed.refreshIntervalMinutes
            : DEFAULT_SETTINGS.refreshIntervalMinutes,
        enableDevMock: Boolean(parsed.enableDevMock),
      };
    } catch (err) {
      console.warn(`[pi-usage-core] Failed to read ${this.filePath}, using defaults: ${err}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  private async save(settings: UsageSettings): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const content = JSON.stringify(settings, null, 2);
      writeFileSync(tmpPath, content, "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error(`[pi-usage-core] Failed to save settings to ${this.filePath}: ${err}`);
      throw err;
    }
  }
}
