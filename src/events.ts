import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GlobalUsageBridge, UsageAccount, UsageProviderAdapter } from "./types.js";

export const EVENT_REGISTER = "pi-usage:register";
export const EVENT_DISCOVER = "pi-usage:discover";
export const EVENT_UPDATED = "pi-usage:updated";

export interface IProviderRegistry {
  register(adapter: UsageProviderAdapter): void;
  getAdapters(): UsageProviderAdapter[];
}

declare global {
  var __PI_USAGE__: GlobalUsageBridge | undefined;
}

/**
 * Configure the pi.events bus listeners and globalThis bridge for adapter registration.
 */
export function setupUsageEventBus(
  pi: ExtensionAPI,
  registry: IProviderRegistry,
  onRegistered?: (adapter: UsageProviderAdapter) => void,
): () => void {
  // Listen for registration events from other extensions
  const unsubRegister = pi.events.on(EVENT_REGISTER, (data: unknown) => {
    if (isValidAdapter(data)) {
      registry.register(data);
      onRegistered?.(data);
    }
  });

  // Setup globalThis bridge for same-process fallback
  globalThis.__PI_USAGE__ = {
    register: (adapter: UsageProviderAdapter) => {
      if (isValidAdapter(adapter)) {
        registry.register(adapter);
        onRegistered?.(adapter);
      }
    },
    getAdapters: () => registry.getAdapters(),
  };

  return () => {
    unsubRegister();
    globalThis.__PI_USAGE__ = undefined;
  };
}

/**
 * Broadcast discover event asking already-loaded provider extensions to register.
 */
export function discoverProviders(pi: ExtensionAPI): void {
  pi.events.emit(EVENT_DISCOVER, undefined);
}

/**
 * Notify listeners that usage data for a provider was updated.
 */
export function notifyUsageUpdated(
  pi: ExtensionAPI,
  providerId: string,
  accounts: UsageAccount[],
): void {
  pi.events.emit(EVENT_UPDATED, { providerId, accounts });
}

function isValidAdapter(candidate: unknown): candidate is UsageProviderAdapter {
  if (!candidate || typeof candidate !== "object") return false;
  const a = candidate as Partial<UsageProviderAdapter>;
  return (
    typeof a.id === "string" &&
    a.id.trim().length > 0 &&
    typeof a.displayName === "string" &&
    typeof a.getAccounts === "function" &&
    typeof a.refresh === "function"
  );
}
