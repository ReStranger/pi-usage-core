import type { Theme } from "@earendil-works/pi-coding-agent";
import { clampPercent } from "./formatters.js";

/**
 * Render visual progress bar with block characters [████████░░░░].
 *
 * @param remainingPct percentage of quota remaining (0 - 100)
 * @param width total bar character width (default 16)
 * @param theme optional theme for semantic coloring (success/warning/error)
 */
export function renderProgressBar(
  remainingPct: number,
  width = 16,
  theme?: Theme,
): string {
  const clamped = clampPercent(remainingPct);
  const filledCount = Math.max(0, Math.min(width, Math.round((clamped / 100) * width)));
  const emptyCount = Math.max(0, width - filledCount);

  const filledChar = "█";
  const emptyChar = "░";

  const filledPart = filledChar.repeat(filledCount);
  const emptyPart = emptyChar.repeat(emptyCount);

  if (!theme) {
    return `${filledPart}${emptyPart}`;
  }

  // Choose semantic color: green if ample, yellow if getting low, red if critical
  let colorToken: "success" | "warning" | "error" = "error";
  if (clamped > 50) {
    colorToken = "success";
  } else if (clamped >= 20) {
    colorToken = "warning";
  }

  const styledFilled = theme.fg(colorToken, filledPart);
  const styledEmpty = theme.fg("dim", emptyPart);

  return `${styledFilled}${styledEmpty}`;
}

/**
 * Render compact mini-bar for footer status line (e.g. "[██░░]").
 */
export function renderMiniBar(
  remainingPct: number,
  width = 6,
  theme?: Theme,
): string {
  return renderProgressBar(remainingPct, width, theme);
}
