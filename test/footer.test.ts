import { describe, expect, it } from "bun:test";
import { FooterManager } from "../src/footer.js";
import { MockUsageAdapter } from "../src/mock-adapter.js";
import { ProviderRegistry } from "../src/registry.js";
import { SettingsManager } from "../src/settings.js";

describe("FooterManager", () => {
  it("computes status text for percent format", async () => {
    const settings = new SettingsManager();
    await settings.update({ footerFormat: "percent", footerMetric: "used" });

    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    const dummyCtx = {
      model: { id: "gemini-2.5-pro", provider: "mock" },
    } as any;

    await registry.getAccounts(dummyCtx, "mock", false);
    const footer = new FooterManager(registry, settings);

    const status = footer.computeStatusText(dummyCtx);
    expect(status).toBeDefined();
    expect(status).toContain("used: ");
    expect(status).toContain("%");
  });

  it("dynamically resolves model pool (Gemini vs Claude)", async () => {
    const settings = new SettingsManager();
    await settings.update({ footerFormat: "percent", footerMetric: "remaining" });

    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    const footer = new FooterManager(registry, settings);

    // Context with Gemini model
    const geminiCtx = {
      model: { id: "gemini-2.5-pro", provider: "mock" },
    } as any;
    await registry.getAccounts(geminiCtx, "mock", false);
    const geminiStatus = footer.computeStatusText(geminiCtx);

    // Context with Claude model
    const claudeCtx = {
      model: { id: "claude-3-7-sonnet", provider: "mock" },
    } as any;
    const claudeStatus = footer.computeStatusText(claudeCtx);

    expect(geminiStatus).toBeDefined();
    expect(claudeStatus).toBeDefined();
    // Gemini pool has remaining 68%, Claude pool has remaining 25%
    expect(geminiStatus).toBe("rem: 68%");
    expect(claudeStatus).toBe("rem: 25%");
  });

  it("formats with countdown timer in with-reset format", async () => {
    const settings = new SettingsManager();
    await settings.update({ footerFormat: "with-reset", footerMetric: "used" });

    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    const dummyCtx = {
      model: { id: "gemini-2.5-pro", provider: "mock" },
    } as any;

    await registry.getAccounts(dummyCtx, "mock", false);
    const footer = new FooterManager(registry, settings);

    const status = footer.computeStatusText(dummyCtx);
    expect(status).toBeDefined();
    expect(status).toContain("used: 32%");
    expect(status).toContain("↻");
    expect(status).toContain("2h 14m");
  });

  it("formats multi-window style", async () => {
    const settings = new SettingsManager();
    await settings.update({ footerFormat: "multi-window", footerMetric: "remaining" });

    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    const dummyCtx = {
      model: { id: "gemini-2.5-pro", provider: "mock" },
    } as any;

    await registry.getAccounts(dummyCtx, "mock", false);
    const footer = new FooterManager(registry, settings);

    const status = footer.computeStatusText(dummyCtx);
    expect(status).toBeDefined();
    // Primary 5h + Daily: "5: 68% ↻ 2h 14m · D: 82% ↻ 8h 30m"
    expect(status).toContain("5: 68%");
    expect(status).toContain("D: 82%");
  });

  it("clears status when active provider has no adapter", async () => {
    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);
    const footer = new FooterManager(registry, settings);

    const unknownCtx = {
      model: { id: "unknown-model", provider: "unknown-provider" },
    } as any;

    const status = footer.computeStatusText(unknownCtx);
    expect(status).toBeUndefined();
  });
});
