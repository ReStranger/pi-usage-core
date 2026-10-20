import { describe, expect, it } from "bun:test";
import { EVENT_DISCOVER, EVENT_REGISTER, discoverProviders, setupUsageEventBus } from "../src/events.js";
import { MockUsageAdapter } from "../src/mock-adapter.js";
import { ProviderRegistry } from "../src/registry.js";
import { SettingsManager } from "../src/settings.js";

describe("Usage EventBus", () => {
  it("registers adapter via pi.events bus", () => {
    const handlers = new Map<string, (data: any) => void>();
    const fakePi = {
      events: {
        on: (channel: string, handler: (data: any) => void) => {
          handlers.set(channel, handler);
          return () => handlers.delete(channel);
        },
        emit: (channel: string, data: any) => {
          const fn = handlers.get(channel);
          if (fn) fn(data);
        },
      },
    } as any;

    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);

    let registeredCount = 0;
    const cleanup = setupUsageEventBus(fakePi, registry, () => {
      registeredCount++;
    });

    const mockAdapter = new MockUsageAdapter();
    fakePi.events.emit(EVENT_REGISTER, mockAdapter);

    expect(registeredCount).toBe(1);
    expect(registry.getAdapters().length).toBe(1);
    expect(registry.getAdapter("mock")).toBeDefined();

    cleanup();
  });

  it("handles discovery broadcast", () => {
    let discoverFired = false;
    const fakePi = {
      events: {
        emit: (channel: string) => {
          if (channel === EVENT_DISCOVER) discoverFired = true;
        },
      },
    } as any;

    discoverProviders(fakePi);
    expect(discoverFired).toBe(true);
  });

  it("registers adapter via globalThis bridge", () => {
    const fakePi = {
      events: {
        on: () => () => {},
        emit: () => {},
      },
    } as any;

    const settings = new SettingsManager();
    const registry = new ProviderRegistry(settings);

    const cleanup = setupUsageEventBus(fakePi, registry);
    expect(globalThis.__PI_USAGE__).toBeDefined();

    const mock = new MockUsageAdapter();
    globalThis.__PI_USAGE__?.register(mock);

    expect(registry.getAdapters().length).toBe(1);
    cleanup();
  });
});
