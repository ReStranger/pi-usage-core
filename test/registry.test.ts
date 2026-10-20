import { describe, expect, it } from "bun:test";
import { MockUsageAdapter } from "../src/mock-adapter.js";
import { ProviderRegistry } from "../src/registry.js";
import { SettingsManager } from "../src/settings.js";

describe("ProviderRegistry", () => {
  const dummyCtx = {} as any;

  it("registers and retrieves adapters", () => {
    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();

    registry.register(mock);
    expect(registry.getAdapters().length).toBe(1);
    expect(registry.getAdapter("mock")).toBe(mock);
  });

  it("caches accounts and respects forceRefresh", async () => {
    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    const first = await registry.getAccounts(dummyCtx, "mock", false);
    expect(first.length).toBe(2);
    expect(first[0]?.name).toBe("Work Account");

    // Second call without forceRefresh returns cached reference
    const second = await registry.getAccounts(dummyCtx, "mock", false);
    expect(second).toBe(first);

    // Call with forceRefresh fetches fresh data
    const third = await registry.getAccounts(dummyCtx, "mock", true);
    expect(third).not.toBe(first);
  });

  it("returns active account correctly", async () => {
    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);
    const mock = new MockUsageAdapter();
    registry.register(mock);

    await registry.getAccounts(dummyCtx, "mock", false);
    const active = registry.getActiveAccount("mock");
    expect(active?.isActive).toBe(true);
    expect(active?.name).toBe("Work Account");
  });

  it("gracefully falls back on adapter errors", async () => {
    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);
    const failingAdapter = {
      id: "failing",
      displayName: "Failing AI",
      getAccounts: async () => {
        throw new Error("Network timeout");
      },
      refresh: async () => {
        throw new Error("Network timeout");
      },
    };

    registry.register(failingAdapter);
    const accounts = await registry.getAccounts(dummyCtx, "failing", false);
    expect(accounts.length).toBe(1);
    expect(accounts[0]?.status).toBe("error");
    expect(accounts[0]?.errorMessage).toContain("Network timeout");
  });
});
