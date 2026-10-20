import type { UsageMetric, UsageQuotaBucket } from "../types.js";

/**
 * Format time delta until reset as human-readable countdown string (e.g., "2h 14m", "4d 17h", "resets now").
 */
export function formatResetCountdown(resetsAt: number | undefined, now = Date.now()): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return "";
  }

  const deltaMs = resetsAt - now;
  if (deltaMs <= 0) {
    return "resets now";
  }

  const totalMinutes = Math.round(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "< 1m";
}

/**
 * Format absolute reset timestamp (e.g. "(at 17:30)" or "(25 Oct 17:30)").
 */
export function formatResetTimestamp(resetsAt: number | undefined): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return "";
  }

  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "";

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  const today = new Date();
  if (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  ) {
    return `at ${timeStr}`;
  }

  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: "short" });
  return `on ${day} ${month} at ${timeStr}`;
}

/**
 * Clamp percentage to [0, 100].
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Extract normalized used & remaining percentages from a quota bucket.
 */
export function resolveBucketPercentages(bucket: UsageQuotaBucket): {
  usedPct: number;
  remainingPct: number;
} {
  if (bucket.unit === "percent") {
    const rem = bucket.remaining !== undefined ? bucket.remaining : (100 - (bucket.used ?? 0));
    const used = bucket.used !== undefined ? bucket.used : (100 - rem);
    return {
      usedPct: clampPercent(used),
      remainingPct: clampPercent(rem),
    };
  }

  if (bucket.limit !== undefined && bucket.limit > 0) {
    if (bucket.used !== undefined) {
      const usedPct = clampPercent((bucket.used / bucket.limit) * 100);
      const remainingPct = clampPercent(100 - usedPct);
      return { usedPct, remainingPct };
    }
    if (bucket.remaining !== undefined) {
      const remainingPct = clampPercent((bucket.remaining / bucket.limit) * 100);
      const usedPct = clampPercent(100 - remainingPct);
      return { usedPct, remainingPct };
    }
  }

  // Fallback defaults
  const rem = bucket.remaining !== undefined ? clampPercent(bucket.remaining) : 100;
  const used = bucket.used !== undefined ? clampPercent(bucket.used) : (100 - rem);
  return { usedPct: used, remainingPct: rem };
}

/**
 * Format metric value into human-readable string.
 */
export function formatMetric(metric: UsageMetric): string {
  if (metric.unit === "currency" || metric.currency) {
    const sym = metric.currency === "USD" || !metric.currency ? "$" : `${metric.currency} `;
    const num = typeof metric.value === "number" ? metric.value.toFixed(2) : String(metric.value);
    return `${sym}${num}`;
  }
  if (metric.unit === "tokens" && typeof metric.value === "number") {
    if (metric.value >= 1_000_000) {
      return `${(metric.value / 1_000_000).toFixed(1)}M tokens`;
    }
    if (metric.value >= 1_000) {
      return `${(metric.value / 1_000).toFixed(1)}k tokens`;
    }
    return `${metric.value} tokens`;
  }
  return String(metric.value);
}
