import { describe, expect, it } from "bun:test";
import {
  clampPercent,
  formatMetric,
  formatResetCountdown,
  formatResetTimestamp,
  resolveBucketPercentages,
} from "../src/ui/formatters.js";
import { renderProgressBar } from "../src/ui/progress-bar.js";

describe("formatters", () => {
  describe("formatResetCountdown", () => {
    it("handles undefined, zero, or negative timestamps", () => {
      expect(formatResetCountdown(undefined)).toBe("");
      expect(formatResetCountdown(0)).toBe("");
      expect(formatResetCountdown(-100)).toBe("");
    });

    it("returns 'resets now' when reset time is in the past", () => {
      const now = 1_000_000;
      expect(formatResetCountdown(now - 1000, now)).toBe("resets now");
      expect(formatResetCountdown(now, now)).toBe("resets now");
    });

    it("formats minutes correctly", () => {
      const now = 1_000_000;
      const target = now + 42 * 60 * 1000;
      expect(formatResetCountdown(target, now)).toBe("42m");
    });

    it("formats hours and minutes", () => {
      const now = 1_000_000;
      const target = now + (2 * 60 + 14) * 60 * 1000;
      expect(formatResetCountdown(target, now)).toBe("2h 14m");
    });

    it("formats days and hours", () => {
      const now = 1_000_000;
      const target = now + (4 * 24 + 17) * 60 * 60 * 1000;
      expect(formatResetCountdown(target, now)).toBe("4d 17h");
    });

    it("formats reset timestamp", () => {
      const now = Date.now();
      expect(formatResetTimestamp(now)).toContain("at ");
      expect(formatResetTimestamp(undefined)).toBe("");
    });
  });

  describe("clampPercent", () => {
    it("clamps numbers between 0 and 100", () => {
      expect(clampPercent(-10)).toBe(0);
      expect(clampPercent(150)).toBe(100);
      expect(clampPercent(42.4)).toBe(42);
      expect(clampPercent(42.6)).toBe(43);
      expect(clampPercent(Number.NaN)).toBe(0);
    });
  });

  describe("resolveBucketPercentages", () => {
    it("resolves from percent unit with used", () => {
      const bucket = {
        id: "b1",
        label: "5h",
        used: 35,
        unit: "percent" as const,
      };
      const res = resolveBucketPercentages(bucket);
      expect(res.usedPct).toBe(35);
      expect(res.remainingPct).toBe(65);
    });

    it("resolves from percent unit with remaining", () => {
      const bucket = {
        id: "b1",
        label: "5h",
        remaining: 80,
        unit: "percent" as const,
      };
      const res = resolveBucketPercentages(bucket);
      expect(res.usedPct).toBe(20);
      expect(res.remainingPct).toBe(80);
    });

    it("resolves from count unit with limit and used", () => {
      const bucket = {
        id: "b2",
        label: "requests",
        used: 100,
        limit: 500,
        unit: "count" as const,
      };
      const res = resolveBucketPercentages(bucket);
      expect(res.usedPct).toBe(20);
      expect(res.remainingPct).toBe(80);
    });
  });

  describe("formatMetric", () => {
    it("formats currency correctly", () => {
      expect(formatMetric({ id: "m1", label: "Cost", value: 12.345, unit: "currency" })).toBe("$12.35");
      expect(formatMetric({ id: "m2", label: "Cost EUR", value: 10, unit: "currency", currency: "EUR" })).toBe("EUR 10.00");
    });

    it("formats tokens with suffixes", () => {
      expect(formatMetric({ id: "t1", label: "Tokens", value: 1_500_000, unit: "tokens" })).toBe("1.5M tokens");
      expect(formatMetric({ id: "t2", label: "Tokens", value: 45_000, unit: "tokens" })).toBe("45.0k tokens");
      expect(formatMetric({ id: "t3", label: "Tokens", value: 500, unit: "tokens" })).toBe("500 tokens");
    });
  });

  describe("renderProgressBar", () => {
    it("renders full remaining bar", () => {
      const bar = renderProgressBar(100, 10);
      expect(bar).toBe("██████████");
    });

    it("renders empty remaining bar", () => {
      const bar = renderProgressBar(0, 10);
      expect(bar).toBe("░░░░░░░░░░");
    });

    it("renders 50% remaining bar", () => {
      const bar = renderProgressBar(50, 10);
      expect(bar).toBe("█████░░░░░");
    });
  });
});
