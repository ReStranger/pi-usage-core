import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "./registry.js";
import type { SettingsManager } from "./settings.js";
import type { UsageAccount, UsageModelPool, UsageSettings } from "./types.js";
import { formatResetCountdown, resolveBucketPercentages } from "./ui/formatters.js";
import { renderMiniBar } from "./ui/progress-bar.js";

const STATUS_KEY = "usage";
const COUNTDOWN_TICK_MS = 60 * 1000;

export class FooterManager {
  private networkTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  private isDisposed = false;

  constructor(
    private registry: ProviderRegistry,
    private settingsManager: SettingsManager,
  ) {}

  update(ctx: ExtensionContext): void {
    if (this.isDisposed) return;
    this.scheduleTimers(ctx);
    this.renderStatus(ctx);
  }

  private scheduleTimers(ctx: ExtensionContext): void {
    this.clearTimers();

    const ttlMs = this.settingsManager.get().refreshIntervalMinutes * 60 * 1000;
    this.networkTimer = setTimeout(() => {
      if (this.isDisposed) return;
      this.update(ctx);
    }, ttlMs);
    this.networkTimer.unref?.();

    // Local countdown repaint every minute
    this.countdownTimer = setTimeout(() => {
      if (this.isDisposed) return;
      this.renderStatus(ctx);
      // Re-schedule countdown
      this.scheduleCountdownOnly(ctx);
    }, COUNTDOWN_TICK_MS);
    this.countdownTimer.unref?.();
  }

  private scheduleCountdownOnly(ctx: ExtensionContext): void {
    if (this.isDisposed) return;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);

    this.countdownTimer = setTimeout(() => {
      if (this.isDisposed) return;
      this.renderStatus(ctx);
      this.scheduleCountdownOnly(ctx);
    }, COUNTDOWN_TICK_MS);
    this.countdownTimer.unref?.();
  }

  private renderStatus(ctx: ExtensionContext): void {
    if (this.isDisposed) return;

    try {
      const text = this.computeStatusText(ctx);
      ctx.ui.setStatus(STATUS_KEY, text);
    } catch {
      // In case of stale context during reload/shutdown
    }
  }

  computeStatusText(ctx: ExtensionContext): string | undefined {
    const settings = this.settingsManager.get();
    const { targetAccount, targetPool } = this.resolveActiveTarget(ctx, settings);

    if (!targetAccount || !targetPool || targetPool.buckets.length === 0) {
      if (targetAccount?.status === "error") {
        return ctx.ui?.theme ? ctx.ui.theme.fg("error", "usage: err") : "usage: err";
      }
      if (targetAccount?.status === "auth-required") {
        return ctx.ui?.theme ? ctx.ui.theme.fg("warning", "usage: auth") : "usage: auth";
      }
      return undefined;
    }

    const primaryBucket =
      targetPool.buckets.find((b) => b.isPrimary) || targetPool.buckets[0];
    if (!primaryBucket) return undefined;

    const { usedPct, remainingPct } = resolveBucketPercentages(primaryBucket);
    const metricVal = settings.footerMetric === "used" ? usedPct : remainingPct;
    const prefix = settings.footerMetric === "used" ? "used" : "rem";
    const countdown = formatResetCountdown(primaryBucket.resetsAt);
    const theme = ctx.ui?.theme;

    switch (settings.footerFormat) {
      case "percent": {
        return `${prefix}: ${metricVal}%`;
      }

      case "with-reset": {
        const resetPart = countdown ? ` ↻ ${countdown}` : "";
        return `${prefix}: ${metricVal}%${resetPart}`;
      }

      case "multi-window": {
        // Multi-window style: e.g. "S 10% · W 23% ↻ 4d"
        const parts: string[] = [];
        for (const bucket of targetPool.buckets) {
          const { usedPct: u, remainingPct: r } = resolveBucketPercentages(bucket);
          const val = settings.footerMetric === "used" ? u : r;
          const letter = (bucket.period || bucket.label || "L").charAt(0).toUpperCase();
          const cd = formatResetCountdown(bucket.resetsAt);
          const cdStr = cd ? ` ↻ ${cd}` : "";
          parts.push(`${letter}: ${val}%${cdStr}`);
        }
        return parts.join(" · ");
      }

      case "bar": {
        const miniBar = renderMiniBar(remainingPct, 6, theme);
        return `${miniBar} ${metricVal}%`;
      }

      default:
        return `${prefix}: ${metricVal}%`;
    }
  }

  private resolveActiveTarget(
    ctx: ExtensionContext,
    settings: UsageSettings,
  ): { targetAccount?: UsageAccount; targetPool?: UsageModelPool } {
    let targetProviderId = ctx.model?.provider;

    if (settings.pinnedTarget) {
      targetProviderId = settings.pinnedTarget.providerId;
    }

    if (!targetProviderId) {
      return {};
    }

    const adapter = this.registry.getAdapter(targetProviderId);
    if (!adapter) {
      return {};
    }

    const account = this.registry.getActiveAccount(targetProviderId);
    if (!account) {
      return {};
    }

    // Match pool by model ID
    const activeModelId = ctx.model?.id?.toLowerCase();
    let targetPool: UsageModelPool | undefined;

    if (activeModelId && account.pools.length > 0) {
      targetPool = account.pools.find((pool) =>
        pool.modelKeys?.some((k) => activeModelId.includes(k.toLowerCase())),
      );
    }

    if (!targetPool && account.pools.length > 0) {
      targetPool = account.pools[0];
    }

    return { targetAccount: account, targetPool };
  }

  clearTimers(): void {
    if (this.networkTimer) {
      clearTimeout(this.networkTimer);
      this.networkTimer = undefined;
    }
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = undefined;
    }
  }

  dispose(ctx?: ExtensionContext): void {
    this.isDisposed = true;
    this.clearTimers();
    if (ctx) {
      try {
        ctx.ui.setStatus(STATUS_KEY, undefined);
      } catch {
        // Safe ignore
      }
    }
  }
}
