import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageAccount, UsageProviderAdapter } from "./types.js";

/**
 * Reference Mock Adapter demonstrating multi-account support,
 * distinct model pools (e.g. Gemini pool vs Claude/GPT pool),
 * reset countdowns, and balance metrics.
 */
export class MockUsageAdapter implements UsageProviderAdapter {
  readonly id = "mock";
  readonly displayName = "Mock AI";

  private refreshCount = 0;

  async getAccounts(_ctx: ExtensionContext): Promise<UsageAccount[]> {
    const now = Date.now();
    const bonus = this.refreshCount % 10;

    return [
      {
        id: "work-acc",
        name: "Work Account",
        email: "developer@company.com",
        status: "ready",
        isActive: true,
        lastUpdated: now,
        pools: [
          {
            id: "gemini-pool",
            name: "Gemini Models (Flash, Pro)",
            modelKeys: ["gemini", "gemini-2.5-pro", "gemini-3.0-flash"],
            description: "Shared quota pool for all Gemini model variations",
            buckets: [
              {
                id: "gemini-5h",
                label: "Session (5h)",
                period: "5h",
                used: Math.min(100, 32 + bonus),
                remaining: Math.max(0, 68 - bonus),
                unit: "percent",
                resetsAt: now + (2 * 60 + 14) * 60 * 1000, // 2h 14m
                isPrimary: true,
              },
              {
                id: "gemini-daily",
                label: "Daily Limit",
                period: "daily",
                used: 18,
                remaining: 82,
                unit: "percent",
                resetsAt: now + (8 * 60 + 30) * 60 * 1000, // 8h 30m
              },
            ],
          },
          {
            id: "claude-gpt-pool",
            name: "Claude & GPT Models",
            modelKeys: ["claude", "claude-3-7-sonnet", "gpt-4o", "gpt-5"],
            description: "High-tier reasoning models with weekly allocation",
            buckets: [
              {
                id: "claude-5h",
                label: "Session (5h)",
                period: "5h",
                used: 75,
                remaining: 25,
                unit: "percent",
                resetsAt: now + 42 * 60 * 1000, // 42m
                isPrimary: true,
              },
              {
                id: "claude-weekly",
                label: "Weekly (1w)",
                period: "weekly",
                used: 48,
                remaining: 52,
                unit: "percent",
                resetsAt: now + (4 * 24 + 17) * 60 * 60 * 1000, // 4d 17h
              },
            ],
          },
        ],
        metrics: [
          {
            id: "extra-credits",
            label: "Extra Credits",
            value: 70.0,
            unit: "currency",
            currency: "USD",
          },
          {
            id: "monthly-limit",
            label: "Max Spending",
            value: 4250.0,
            unit: "currency",
            currency: "USD",
          },
        ],
      },
      {
        id: "personal-acc",
        name: "Personal Account",
        email: "developer@personal.me",
        status: "ready",
        isActive: false,
        lastUpdated: now,
        pools: [
          {
            id: "standard-pool",
            name: "Standard Quota",
            modelKeys: ["gemini-flash", "gpt-3.5"],
            buckets: [
              {
                id: "std-daily",
                label: "Daily (24h)",
                period: "daily",
                used: 12,
                remaining: 88,
                unit: "percent",
                resetsAt: now + 5 * 60 * 60 * 1000,
                isPrimary: true,
              },
            ],
          },
        ],
      },
    ];
  }

  async refresh(ctx: ExtensionContext, _accountId?: string): Promise<UsageAccount[]> {
    this.refreshCount++;
    return this.getAccounts(ctx);
  }
}
