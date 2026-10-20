import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { UsageAccount, UsageModelPool, UsageProviderAdapter, UsageQuotaBucket } from "../src/types.js";

export default function (pi: ExtensionAPI): void {
  const adapter: UsageProviderAdapter = {
    id: "antigravity",
    displayName: "Google Antigravity",

    async getAccounts(ctx: ExtensionContext): Promise<UsageAccount[]> {
      const apiKey = await resolveAntigravityKey(ctx);
      if (!apiKey) {
        return [
          {
            id: "antigravity-default",
            name: "Google Antigravity",
            status: "auth-required",
            errorMessage: "No Antigravity credentials found. Run /login antigravity first.",
            pools: [],
            lastUpdated: Date.now(),
          },
        ];
      }

      try {
        // Dynamically import fetchAccountUsage from the installed antigravity extension
        const agModule = await import(
          /* @vite-ignore */
          "/home/restranger/.config/pi/agent/npm/node_modules/@heyhuynhgiabuu/pi-oauth-antigravity/dist/usage/usage.js"
        );

        const usage = await agModule.fetchAccountUsage(apiKey);
        const pools: UsageModelPool[] = [];

        for (const group of usage.groups) {
          const isGemini = /gemini/i.test(group.displayName);
          const isClaude = /claude|gpt/i.test(group.displayName);

          let poolId = group.displayName;
          let modelKeys = [group.displayName.toLowerCase()];

          if (isGemini) {
            poolId = "gemini";
            modelKeys = ["gemini", "gemini-2.5", "gemini-3.0"];
          } else if (isClaude) {
            poolId = "claude-gpt";
            modelKeys = ["claude", "gpt"];
          }

          const buckets: UsageQuotaBucket[] = group.buckets.map(
            (b: { bucketId?: string; displayName: string; remainingFraction?: number; resetTime?: string }) => {
              const remFraction = typeof b.remainingFraction === "number" ? b.remainingFraction : 1.0;
              const remaining = Math.round(remFraction * 100);
              const used = Math.max(0, 100 - remaining);
              const is5h = /five hour|5h/i.test(b.displayName);

              let resetsAt: number | undefined;
              if (b.resetTime) {
                const ts = Date.parse(b.resetTime);
                if (Number.isFinite(ts)) resetsAt = ts;
              }

              return {
                id: b.bucketId || b.displayName,
                label: b.displayName,
                period: is5h ? "5h" : "weekly",
                used,
                remaining,
                unit: "percent",
                resetsAt,
                isPrimary: is5h,
              };
            },
          );

          pools.push({
            id: poolId,
            name: group.displayName,
            description: group.description,
            modelKeys,
            buckets,
          });
        }

        const planLabel = usage.planLabel || usage.paidTier?.name || usage.productTier?.name || "Ready";

        return [
          {
            id: usage.projectId || "antigravity-active",
            name: usage.email ? `Account (${usage.email})` : "Antigravity Account",
            email: usage.email,
            status: "ready",
            isActive: true,
            lastUpdated: Date.now(),
            pools,
            metrics: [
              {
                id: "plan-tier",
                label: "Plan",
                value: planLabel,
              },
            ],
          },
        ];
      } catch (err) {
        return [
          {
            id: "antigravity-error",
            name: "Google Antigravity",
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            pools: [],
            lastUpdated: Date.now(),
          },
        ];
      }
    },

    async refresh(ctx: ExtensionContext): Promise<UsageAccount[]> {
      return this.getAccounts(ctx);
    },
  };

  // Register in pi-usage
  pi.events.emit("pi-usage:register", adapter);

  // Re-register if pi-usage discovers later
  pi.events.on("pi-usage:discover", () => {
    pi.events.emit("pi-usage:register", adapter);
  });
}

async function resolveAntigravityKey(ctx: ExtensionContext): Promise<string | undefined> {
  // Method 1: Check auth.json
  try {
    const authPath = join(getAgentDir(), "auth.json");
    if (existsSync(authPath)) {
      const data = JSON.parse(readFileSync(authPath, "utf-8"));
      const ag = data.antigravity;
      if (ag && ag.access && ag.projectId) {
        return JSON.stringify({ token: ag.access, projectId: ag.projectId });
      }
    }
  } catch {
    // Ignore and try method 2
  }

  // Method 2: Try resolver from antigravity module
  try {
    const agModule = await import(
      /* @vite-ignore */
      "/home/restranger/.config/pi/agent/npm/node_modules/@heyhuynhgiabuu/pi-oauth-antigravity/dist/usage/usage.js"
    );
    return await agModule.resolveApiKeyFromContext(ctx);
  } catch {
    return undefined;
  }
}
