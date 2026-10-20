import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { UsageAccount, UsageModelPool, UsageProviderAdapter, UsageQuotaBucket } from "../src/types.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

interface CodexWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface CodexResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    primary_window?: CodexWindow | null;
    secondary_window?: CodexWindow | null;
  } | null;
  additional_rate_limits?: Array<{
    limit_name?: string;
    metered_feature?: string;
    rate_limit?: {
      primary_window?: CodexWindow | null;
    } | null;
  }> | null;
  credits?: {
    balance?: number;
  } | null;
}

export default function (pi: ExtensionAPI): void {
  const adapter: UsageProviderAdapter = {
    id: "openai-codex",
    displayName: "OpenAI Codex",

    async getAccounts(_ctx: ExtensionContext): Promise<UsageAccount[]> {
      const auth = resolveCodexAuth();
      if (!auth) {
        return [
          {
            id: "codex-default",
            name: "OpenAI Codex",
            status: "auth-required",
            errorMessage: "No OpenAI Codex credentials found. Run /login openai-codex first.",
            pools: [],
            lastUpdated: Date.now(),
          },
        ];
      }

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
          "User-Agent": "pi-usage-core/0.1.0",
        };
        if (auth.accountId) {
          headers["ChatGPT-Account-Id"] = auth.accountId;
        }

        const res = await fetch(CODEX_USAGE_URL, { headers });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Codex usage request failed (${res.status}): ${body.slice(0, 300)}`);
        }

        const data = (await res.json()) as CodexResponse;
        const pools: UsageModelPool[] = [];

        // Primary rate limit group
        const rateLimit = data.rate_limit;
        if (rateLimit) {
          const buckets: UsageQuotaBucket[] = [];

          if (rateLimit.primary_window) {
            const pw = rateLimit.primary_window;
            const used = typeof pw.used_percent === "number" ? pw.used_percent : 0;
            const remaining = Math.max(0, 100 - used);
            const resetsAt = typeof pw.reset_at === "number" ? pw.reset_at * 1000 : undefined;
            const period = pw.limit_window_seconds ? formatWindowSeconds(pw.limit_window_seconds) : "5h";

            buckets.push({
              id: "codex-primary",
              label: `Primary Limit (${period})`,
              period,
              used,
              remaining,
              unit: "percent",
              resetsAt,
              isPrimary: true,
            });
          }

          if (rateLimit.secondary_window) {
            const sw = rateLimit.secondary_window;
            const used = typeof sw.used_percent === "number" ? sw.used_percent : 0;
            const remaining = Math.max(0, 100 - used);
            const resetsAt = typeof sw.reset_at === "number" ? sw.reset_at * 1000 : undefined;
            const period = sw.limit_window_seconds ? formatWindowSeconds(sw.limit_window_seconds) : "weekly";

            buckets.push({
              id: "codex-secondary",
              label: `Secondary Limit (${period})`,
              period,
              used,
              remaining,
              unit: "percent",
              resetsAt,
              isPrimary: false,
            });
          }

          pools.push({
            id: "codex-limits",
            name: "ChatGPT Plan Allowance",
            modelKeys: ["gpt", "codex", "o1", "o3", "chatgpt"],
            buckets,
          });
        }

        // Additional rate limits if present
        if (Array.isArray(data.additional_rate_limits)) {
          for (const item of data.additional_rate_limits) {
            const featureName = item.limit_name || item.metered_feature || "Additional Limit";
            const rl = item.rate_limit;
            if (!rl) continue;

            const extraBuckets: UsageQuotaBucket[] = [];
            if (rl.primary_window) {
              const pw = rl.primary_window;
              const used = typeof pw.used_percent === "number" ? pw.used_percent : 0;
              const remaining = Math.max(0, 100 - used);
              const resetsAt = typeof pw.reset_at === "number" ? pw.reset_at * 1000 : undefined;
              const period = pw.limit_window_seconds ? formatWindowSeconds(pw.limit_window_seconds) : "5h";

              extraBuckets.push({
                id: `extra-${featureName}`,
                label: featureName,
                period,
                used,
                remaining,
                unit: "percent",
                resetsAt,
                isPrimary: false,
              });
            }

            pools.push({
              id: `pool-${featureName}`,
              name: featureName,
              buckets: extraBuckets,
            });
          }
        }

        const metrics = [];
        if (data.plan_type) {
          metrics.push({
            id: "plan-type",
            label: "Plan",
            value: String(data.plan_type).toUpperCase(),
          });
        }

        if (data.credits && typeof data.credits.balance === "number") {
          metrics.push({
            id: "credits",
            label: "Credits",
            value: data.credits.balance,
            unit: "count" as const,
          });
        }

        const accountName = data.email ? `OpenAI (${data.email})` : "OpenAI Codex Account";

        return [
          {
            id: data.account_id || "codex-active",
            name: accountName,
            email: data.email,
            status: "ready",
            isActive: true,
            lastUpdated: Date.now(),
            pools,
            metrics,
          },
        ];
      } catch (err) {
        return [
          {
            id: "codex-error",
            name: "OpenAI Codex",
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

function resolveCodexAuth(): { token: string; accountId?: string } | undefined {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    if (!existsSync(authPath)) return undefined;

    const data = JSON.parse(readFileSync(authPath, "utf-8"));
    const codex = data["openai-codex"] || data.openai;
    if (codex && codex.access) {
      return {
        token: codex.access,
        accountId: codex.accountId,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function formatWindowSeconds(seconds: number): string {
  if (seconds >= 24 * 3600 * 7) return "weekly";
  if (seconds >= 24 * 3600) return `${Math.round(seconds / (24 * 3600))}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
}
