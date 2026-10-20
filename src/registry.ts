import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { IProviderRegistry } from "./events.js";
import type { SettingsManager } from "./settings.js";
import type { UsageAccount, UsageProviderAdapter } from "./types.js";

interface CacheEntry {
  accounts: UsageAccount[];
  timestamp: number;
}

export class ProviderRegistry implements IProviderRegistry {
  private adapters = new Map<string, UsageProviderAdapter>();
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<UsageAccount[]>>();

  constructor(private settingsManager: SettingsManager) {}

  register(adapter: UsageProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(providerId: string): void {
    this.adapters.delete(providerId);
    this.cache.delete(providerId);
    this.inFlight.delete(providerId);
  }

  getAdapters(): UsageProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  getAdapter(providerId: string): UsageProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  async getAccounts(
    ctx: ExtensionContext,
    providerId: string,
    forceRefresh = false,
  ): Promise<UsageAccount[]> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      return [];
    }

    const ttlMs = this.settingsManager.get().refreshIntervalMinutes * 60 * 1000;
    const cached = this.cache.get(providerId);
    const now = Date.now();

    if (!forceRefresh && cached && now - cached.timestamp < ttlMs) {
      return cached.accounts;
    }

    // Deduplicate in-flight requests for the same provider
    const existingPromise = this.inFlight.get(providerId);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async () => {
      try {
        const accounts = forceRefresh
          ? await adapter.refresh(ctx)
          : await adapter.getAccounts(ctx);

        this.cache.set(providerId, {
          accounts,
          timestamp: Date.now(),
        });
        return accounts;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // If we have stale cache, preserve it but flag the error
        if (cached && cached.accounts.length > 0) {
          const fallbackAccounts = cached.accounts.map((acc) => ({
            ...acc,
            status: "error" as const,
            errorMessage: errorMsg,
          }));
          return fallbackAccounts;
        }

        // Return a fallback error account
        const fallback: UsageAccount = {
          id: "default",
          name: adapter.displayName,
          status: "error",
          errorMessage: errorMsg,
          pools: [],
          lastUpdated: Date.now(),
        };
        return [fallback];
      } finally {
        this.inFlight.delete(providerId);
      }
    })();

    this.inFlight.set(providerId, fetchPromise);
    return fetchPromise;
  }

  async getAllAccounts(
    ctx: ExtensionContext,
    forceRefresh = false,
  ): Promise<{ provider: UsageProviderAdapter; accounts: UsageAccount[] }[]> {
    const adapters = this.getAdapters();
    const results = await Promise.allSettled(
      adapters.map(async (adapter) => {
        const accounts = await this.getAccounts(ctx, adapter.id, forceRefresh);
        return { provider: adapter, accounts };
      }),
    );

    const outcomes: { provider: UsageProviderAdapter; accounts: UsageAccount[] }[] = [];
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const adapter = adapters[i];
      if (!adapter) continue;
      if (res && res.status === "fulfilled") {
        outcomes.push(res.value);
      } else {
        outcomes.push({
          provider: adapter,
          accounts: [
            {
              id: "error",
              name: adapter.displayName,
              status: "error",
              errorMessage:
                res && res.status === "rejected"
                  ? String(res.reason)
                  : "Failed to fetch accounts",
              pools: [],
              lastUpdated: Date.now(),
            },
          ],
        });
      }
    }
    return outcomes;
  }

  getActiveAccount(providerId: string): UsageAccount | undefined {
    const cached = this.cache.get(providerId);
    if (!cached || cached.accounts.length === 0) return undefined;
    return (
      cached.accounts.find((acc) => acc.isActive) ||
      cached.accounts.find((acc) => acc.status === "ready") ||
      cached.accounts[0]
    );
  }

  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}
