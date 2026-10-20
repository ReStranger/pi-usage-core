import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ProviderRegistry } from "../registry.js";
import type { SettingsManager } from "../settings.js";
import type { UsageAccount, UsageModelPool, UsageProviderAdapter, UsageSettings } from "../types.js";
import {
  formatMetric,
  formatResetCountdown,
  formatResetTimestamp,
  resolveBucketPercentages,
} from "./formatters.js";
import { renderProgressBar } from "./progress-bar.js";

export interface DashboardOptions {
  onFooterChanged?: () => void;
}

export class UsageDashboardComponent {
  private activeProviderIdx = 0;
  private activeAccountIdx = 0;
  private selectedItemIdx = 0;
  private scrollOffset = 0;
  private statusMessage = "";
  private isRefreshing = false;
  private accountsMap = new Map<string, UsageAccount[]>();
  private initialLoaded = false;

  constructor(
    private ctx: ExtensionContext,
    private theme: Theme,
    private registry: ProviderRegistry,
    private settingsManager: SettingsManager,
    private done: () => void,
    private requestRender: () => void,
    private options?: DashboardOptions,
  ) {
    this.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    const adapters = this.registry.getAdapters();
    if (adapters.length === 0) {
      this.initialLoaded = true;
      this.requestRender();
      return;
    }

    // Set initial tab to active model's provider if available
    const activeProvider = this.ctx.model?.provider;
    if (activeProvider) {
      const idx = adapters.findIndex((a) => a.id === activeProvider);
      if (idx >= 0) this.activeProviderIdx = idx;
    }

    // Load accounts for all providers in parallel
    await Promise.all(
      adapters.map(async (adapter) => {
        const accounts = await this.registry.getAccounts(this.ctx, adapter.id, false);
        this.accountsMap.set(adapter.id, accounts);
        return accounts;
      }),
    );

    this.initialLoaded = true;
    this.requestRender();
  }

  private async refreshCurrent(): Promise<void> {
    const adapters = this.registry.getAdapters();
    const adapter = adapters[this.activeProviderIdx];
    if (!adapter || this.isRefreshing) return;

    this.isRefreshing = true;
    this.statusMessage = `Refreshing ${adapter.displayName}…`;
    this.requestRender();

    try {
      const accounts = await this.registry.getAccounts(this.ctx, adapter.id, true);
      this.accountsMap.set(adapter.id, accounts);
      this.statusMessage = `${adapter.displayName} updated`;
      this.options?.onFooterChanged?.();
    } catch (err) {
      this.statusMessage = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.isRefreshing = false;
      this.requestRender();
    }
  }

  private async refreshAll(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    this.statusMessage = "Refreshing all providers…";
    this.requestRender();

    try {
      const results = await this.registry.getAllAccounts(this.ctx, true);
      for (const item of results) {
        this.accountsMap.set(item.provider.id, item.accounts);
      }
      this.statusMessage = "All providers updated";
      this.options?.onFooterChanged?.();
    } catch (err) {
      this.statusMessage = `Refresh all failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.isRefreshing = false;
      this.requestRender();
    }
  }

  private async cycleFooterFormat(): Promise<void> {
    const formats: UsageSettings["footerFormat"][] = ["percent", "with-reset", "multi-window", "bar"];
    const current = this.settingsManager.get().footerFormat;
    const nextIdx = (formats.indexOf(current) + 1) % formats.length;
    const nextFormat = formats[nextIdx] ?? "percent";

    await this.settingsManager.update({ footerFormat: nextFormat });
    this.options?.onFooterChanged?.();
    this.statusMessage = `Footer style: ${nextFormat}`;
    this.requestRender();
  }

  private isModelInPool(pool: UsageModelPool): boolean {
    const activeModelId = this.ctx.model?.id?.toLowerCase();
    if (!activeModelId) return false;
    if (!pool.modelKeys || pool.modelKeys.length === 0) return false;

    return pool.modelKeys.some((k) => activeModelId.includes(k.toLowerCase()));
  }

  private getTotalItems(): number {
    const adapters = this.registry.getAdapters();
    const currentAdapter = adapters[this.activeProviderIdx];
    if (!currentAdapter) return 0;
    const accounts = this.accountsMap.get(currentAdapter.id) || [];
    const currentAccount = accounts[this.activeAccountIdx] || accounts[0];
    if (!currentAccount) return 0;
    let count = 0;
    for (const pool of currentAccount.pools) {
      count += pool.buckets.length;
    }
    return count;
  }

  handleInput(data: string): void {
    const adapters = this.registry.getAdapters();

    // Tab navigation: next provider (l, L, right, tab)
    if (
      matchesKey(data, Key.tab) ||
      data === "l" ||
      data === "L" ||
      matchesKey(data, Key.right)
    ) {
      if (adapters.length > 0) {
        this.activeProviderIdx = (this.activeProviderIdx + 1) % adapters.length;
        this.activeAccountIdx = 0;
        this.selectedItemIdx = 0;
        this.scrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    // Shift+Tab navigation: prev provider (h, H, left, shift+tab)
    if (
      matchesKey(data, Key.shift("tab")) ||
      data === "h" ||
      data === "H" ||
      matchesKey(data, Key.left)
    ) {
      if (adapters.length > 0) {
        this.activeProviderIdx = (this.activeProviderIdx - 1 + adapters.length) % adapters.length;
        this.activeAccountIdx = 0;
        this.selectedItemIdx = 0;
        this.scrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    // Account switching: [ or ]
    if (data === "[" || data === "]") {
      const currentAdapter = adapters[this.activeProviderIdx];
      if (currentAdapter) {
        const accounts = this.accountsMap.get(currentAdapter.id) || [];
        if (accounts.length > 1) {
          const delta = data === "]" ? 1 : -1;
          this.activeAccountIdx = (this.activeAccountIdx + delta + accounts.length) % accounts.length;
          this.selectedItemIdx = 0;
          this.scrollOffset = 0;
          this.requestRender();
        }
      }
      return;
    }

    // Item navigation down: j / J / down
    if (
      matchesKey(data, Key.down) ||
      data === "j" ||
      data === "J"
    ) {
      const total = this.getTotalItems();
      if (total > 0) {
        this.selectedItemIdx = Math.min(total - 1, this.selectedItemIdx + 1);
        this.requestRender();
      }
      return;
    }

    // Item navigation up: k / K / up
    if (
      matchesKey(data, Key.up) ||
      data === "k" ||
      data === "K"
    ) {
      const total = this.getTotalItems();
      if (total > 0) {
        this.selectedItemIdx = Math.max(0, this.selectedItemIdx - 1);
        this.requestRender();
      }
      return;
    }

    // Actions
    if (data === "r" || data === "R") {
      this.refreshCurrent();
      return;
    }
    if (data === "a" || data === "A") {
      this.refreshAll();
      return;
    }
    if (data === "f" || data === "F") {
      this.cycleFooterFormat();
      return;
    }

    // Close
    if (
      matchesKey(data, Key.escape) ||
      data === "q" ||
      data === "Q" ||
      matchesKey(data, "q")
    ) {
      this.done();
      return;
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const adapters = this.registry.getAdapters();
    const activeModel = this.ctx.model;
    const MARGIN = 2;
    const contentWidth = Math.max(20, width - MARGIN * 2);

    // Header title
    const titleText = theme.bold("─ Provider Usage ─");
    const activeModelBadge = activeModel
      ? theme.fg("dim", ` Active: ${activeModel.provider}/${activeModel.id}`)
      : "";
    lines.push(new DynamicBorder((s) => theme.fg("accent", s)).render(width)[0] || "");
    lines.push(truncateToWidth(`  ${titleText} ${activeModelBadge}`, width));

    if (adapters.length === 0) {
      lines.push("");
      lines.push(truncateToWidth(theme.fg("warning", "  No usage providers registered."), width));
      lines.push(
        truncateToWidth(
          theme.fg(
            "dim",
            "  Install a provider plugin (e.g. pi-oauth-antigravity) or enable devMock in extensions/pi-usage.json",
          ),
          width,
        ),
      );
      lines.push("");
      lines.push(new DynamicBorder((s) => theme.fg("accent", s)).render(width)[0] || "");
      lines.push(truncateToWidth(theme.fg("dim", "  [Esc/q] Close"), width));
      return lines;
    }

    // Render Tabs Bar [ OpenCode Go ]  [ Antigravity ✓ ]  [ OpenAI ]
    const tabSegments: string[] = [];
    for (let i = 0; i < adapters.length; i++) {
      const adapter = adapters[i];
      if (!adapter) continue;
      const isActive = i === this.activeProviderIdx;
      const isPiActive = activeModel?.provider === adapter.id;
      const checkMark = isPiActive ? " ✓" : "";
      const label = `${adapter.displayName}${checkMark}`;

      if (isActive) {
        tabSegments.push(theme.style(`[ ${label} ]`, { bold: true, fg: "accent" }));
      } else {
        tabSegments.push(theme.fg("dim", `  ${label}  `));
      }
    }
    lines.push(truncateToWidth(`  ${tabSegments.join(" ")}`, width));

    // Active provider & account details
    const currentAdapter = adapters[this.activeProviderIdx];
    if (!currentAdapter) return lines;

    const accounts = this.accountsMap.get(currentAdapter.id) || [];
    const currentAccount = accounts[this.activeAccountIdx] || accounts[0];

    // Account subheader
    if (accounts.length > 1) {
      const accTabs = accounts.map((acc, idx) => {
        const isCur = idx === this.activeAccountIdx;
        const name = acc.name || `Account ${idx + 1}`;
        return isCur
          ? theme.style(`< ${name} >`, { bold: true, fg: "accent" })
          : theme.fg("dim", `  ${name}  `);
      });
      lines.push(truncateToWidth(`  Account: ${accTabs.join(" ")} ${theme.fg("dim", "([ / ] to switch)")}`, width));
    } else if (currentAccount) {
      const statusText =
        currentAccount.status === "ready"
          ? theme.fg("success", "ready")
          : theme.fg("warning", currentAccount.status);
      const email = currentAccount.email ? ` (${currentAccount.email})` : "";
      lines.push(truncateToWidth(`  Account: ${currentAccount.name}${email} · ${statusText}`, width));
    }

    lines.push(new DynamicBorder((s) => theme.fg("dim", s)).render(width)[0] || "");

    // Body: Pools and Buckets
    const bodyLines: string[] = [];
    if (!this.initialLoaded && !currentAccount) {
      bodyLines.push(theme.fg("dim", "  Loading usage data…"));
    } else if (!currentAccount || currentAccount.pools.length === 0) {
      if (currentAccount?.errorMessage) {
        bodyLines.push(theme.fg("error", `  Error: ${currentAccount.errorMessage}`));
      } else {
        bodyLines.push(theme.fg("dim", "  No quota pools reported for this account."));
      }
    } else {
      let itemIndex = 0;
      for (const pool of currentAccount.pools) {
        const isPoolActive = this.isModelInPool(pool);
        const poolBadge = isPoolActive ? theme.style(" [ACTIVE MODEL]", { fg: "success", bold: true }) : "";
        bodyLines.push(`  ${theme.bold(pool.name)}${poolBadge}`);

        if (pool.description) {
          bodyLines.push(`  ${theme.fg("dim", pool.description)}`);
        }

        const barWidth = Math.max(16, Math.min(24, Math.floor(width / 3.5)));

        for (const bucket of pool.buckets) {
          const isSelected = itemIndex === this.selectedItemIdx;
          itemIndex++;

          const { usedPct, remainingPct } = resolveBucketPercentages(bucket);
          const bar = renderProgressBar(remainingPct, barWidth, theme);
          const label = bucket.label || bucket.period || "Limit";
          const remStr = `${remainingPct.toString().padStart(3, " ")}% left`;
          const usedStr = theme.fg("dim", `(${usedPct.toString().padStart(2, " ")}% used)`);
          const right = `${bar}  ${remStr}  ${usedStr}`;

          const cursor = isSelected ? theme.style("> ", { bold: true, fg: "accent" }) : "  ";
          const labelStyled = isSelected ? theme.bold(label) : label;
          const maxLeftWidth = Math.max(10, contentWidth - visibleWidth(right) - visibleWidth(cursor) - 2);
          const left = `${cursor}${truncateToWidth(labelStyled, maxLeftWidth, "...")}`;

          const padSize = Math.max(2, contentWidth - visibleWidth(left) - visibleWidth(right));
          const pad = " ".repeat(padSize);

          bodyLines.push(`${" ".repeat(MARGIN)}${left}${pad}${right}${" ".repeat(MARGIN)}`);

          const resetCountdown = formatResetCountdown(bucket.resetsAt);
          if (resetCountdown) {
            const resetTime = formatResetTimestamp(bucket.resetsAt);
            const resetStr = `↻ Resets in ${resetCountdown}${resetTime ? ` (${resetTime})` : ""}`;
            const barStartCol = MARGIN + visibleWidth(left) + padSize;
            bodyLines.push(`${" ".repeat(barStartCol)}${theme.fg("dim", resetStr)}`);
          }
        }
        bodyLines.push("");
      }

      // Metrics
      if (currentAccount.metrics && currentAccount.metrics.length > 0) {
        const metricStrs = currentAccount.metrics.map(
          (m) => `${m.label}: ${theme.bold(formatMetric(m))}`,
        );
        bodyLines.push(`  ${theme.fg("dim", "Metrics:")} ${metricStrs.join("  •  ")}`);
        bodyLines.push("");
      }
    }

    // Apply scroll offset
    const visibleBody = bodyLines.slice(this.scrollOffset);
    for (const bLine of visibleBody) {
      lines.push(truncateToWidth(bLine, width));
    }

    // Status message line (if refreshing or notification)
    if (this.statusMessage) {
      lines.push(truncateToWidth(`  ${theme.fg("accent", this.statusMessage)}`, width));
    }

    // Footer Hotkeys
    lines.push(new DynamicBorder((s) => theme.fg("accent", s)).render(width)[0] || "");
    const currentFmt = this.settingsManager.get().footerFormat;
    const hotkeys = [
      "h/l: tabs",
      "j/k: select",
      "[R]efresh",
      "[A]ll",
      `[F]ooter: ${currentFmt}`,
      "[Esc/q] close",
    ].join(" • ");
    lines.push(truncateToWidth(`  ${theme.fg("dim", hotkeys)}`, width));

    return lines;
  }
}

/**
 * Plain-text report generator for non-interactive modes (RPC, print, JSON).
 */
export function formatPlainUsageReport(
  adapters: UsageProviderAdapter[],
  accountsMap: Map<string, UsageAccount[]>,
): string {
  const lines: string[] = ["=== Provider Usage Report ===", ""];
  if (adapters.length === 0) {
    lines.push("No usage providers registered.");
    return lines.join("\n");
  }

  for (const adapter of adapters) {
    lines.push(`Provider: ${adapter.displayName} (${adapter.id})`);
    const accounts = accountsMap.get(adapter.id) || [];
    if (accounts.length === 0) {
      lines.push("  No accounts available.");
      lines.push("");
      continue;
    }

    for (const acc of accounts) {
      lines.push(`  Account: ${acc.name} [Status: ${acc.status}]`);
      if (acc.errorMessage) {
        lines.push(`    Error: ${acc.errorMessage}`);
      }
      for (const pool of acc.pools) {
        lines.push(`    Pool: ${pool.name}`);
        for (const bucket of pool.buckets) {
          const { usedPct, remainingPct } = resolveBucketPercentages(bucket);
          const bar = renderProgressBar(remainingPct, 16);
          const reset = formatResetCountdown(bucket.resetsAt);
          const resetStr = reset ? ` (Resets in ${reset})` : "";
          lines.push(`      ${bucket.label}: ${bar} ${remainingPct}% left (${usedPct}% used)${resetStr}`);
        }
      }
      if (acc.metrics && acc.metrics.length > 0) {
        const mStr = acc.metrics.map((m) => `${m.label}: ${formatMetric(m)}`).join(", ");
        lines.push(`    Metrics: ${mStr}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}
