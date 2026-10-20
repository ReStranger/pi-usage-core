import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Unit of measurement for quota values */
export type UsageUnit = "percent" | "count" | "currency" | "tokens";

/** Account access/authentication status */
export type AccountStatus = "ready" | "auth-required" | "rate-limited" | "error";

/** Period of quota window */
export type QuotaPeriod = "5h" | "daily" | "weekly" | "monthly" | "total" | "unlimited" | string;

/** Single quota limit window */
export interface UsageQuotaBucket {
  id: string;
  label: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: UsageUnit;
  period?: QuotaPeriod;
  /** Reset timestamp in milliseconds (Unix epoch ms) */
  resetsAt?: number;
  /** Primary bucket flag (used for compact footer display by default) */
  isPrimary?: boolean;
}

/**
 * Model pool within an account.
 * Allows separating quotas inside a single provider/account
 * (e.g., Gemini 5h pool vs Claude/GPT pool in Antigravity).
 */
export interface UsageModelPool {
  id: string;
  name: string;
  /** Model identifiers or prefixes matching this pool (e.g. ["gemini-2.5", "gemini-3"] or ["claude", "gpt-4o"]) */
  modelKeys?: string[];
  /** Quota windows belonging to this pool */
  buckets: UsageQuotaBucket[];
  /** Optional human-readable description or billing rule */
  description?: string;
}

/** Additional account metrics (financial balance, bonus tokens, credits) */
export interface UsageMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: UsageUnit;
  currency?: string;
}

/** Provider account (supporting multiple accounts per provider) */
export interface UsageAccount {
  id: string;
  name: string;
  email?: string;
  status: AccountStatus;
  errorMessage?: string;
  /** Active account flag for current Pi session */
  isActive?: boolean;
  /** Model pools and their limits */
  pools: UsageModelPool[];
  /** Financial or balance metrics */
  metrics?: UsageMetric[];
  /** Timestamp of last successful API poll (Unix epoch ms) */
  lastUpdated: number;
}

/** Adapter provided by an external plugin or custom integration */
export interface UsageProviderAdapter {
  /** Provider ID in Pi (matches ctx.model.provider, e.g. "antigravity", "openai") */
  id: string;
  displayName: string;
  icon?: string;

  /**
   * Fetch accounts with pools and current quotas.
   * Adapter can use ctx for reading auth storage, model registry, or performing API requests.
   */
  getAccounts(ctx: ExtensionContext): Promise<UsageAccount[]>;

  /**
   * Force refresh quotas (triggered by Refresh action or expired TTL).
   */
  refresh(ctx: ExtensionContext, accountId?: string): Promise<UsageAccount[]>;
}

/** Event names and payload shapes for pi.events bus */
export interface UsageEvents {
  "pi-usage:register": UsageProviderAdapter;
  "pi-usage:discover": void;
  "pi-usage:updated": { providerId: string; accounts: UsageAccount[] };
}

/** User settings stored in <agent-dir>/extensions/pi-usage.json (respects PI_CODING_AGENT_DIR) */
export interface UsageSettings {
  /** Footer display format: "percent" (used: 10%), "with-reset" (used: 10% ↻ 2h), "multi-window" (S: 10% W: 23% ↻ 4d), "bar" ([██░░] 20%) */
  footerFormat: "percent" | "with-reset" | "multi-window" | "bar";
  /** Display metric: used or remaining */
  footerMetric: "used" | "remaining";
  /** Pinned provider/account for footer (null = track active Pi model) */
  pinnedTarget: { providerId: string; accountId: string } | null;
  /** Background polling interval in minutes (default: 5) */
  refreshIntervalMinutes: number;
  /** Enable built-in mock provider for local development/demo */
  enableDevMock?: boolean;
}

/** Global runtime registry bridge */
export interface GlobalUsageBridge {
  register(adapter: UsageProviderAdapter): void;
  getAdapters(): UsageProviderAdapter[];
}
