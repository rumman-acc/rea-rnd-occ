import { healthCounts, seriesSummaries } from "./derive";
import type { StatusRow } from "./types";

// Literal hex values observed in the original's JS (SPEC NF-002).
export const PALETTE = {
  brand: "#1B4A78",
  navy: "#0D2E52",
  mid: "#8FADD6",
  green: "#16a34a",
  red: "#dc2626",
  amber: "#d97706",
  purple: "#7C4DD2",
  chartText: "#5B6B7C",
} as const;

export function donutData(rows: readonly StatusRow[]) {
  const c = healthCounts(rows);
  return {
    labels: ["Safe", "Watch", "At Risk"],
    datasets: [
      {
        data: [c.green, c.yellow, c.red],
        backgroundColor: [PALETTE.green, PALETTE.amber, PALETTE.red],
        borderWidth: 2,
        borderColor: "#fff",
      },
    ],
  };
}

export function barData(rows: readonly StatusRow[]) {
  const s = seriesSummaries(rows);
  return {
    labels: s.map((x) => x.series),
    datasets: [
      {
        label: "Units",
        data: s.map((x) => x.total),
        backgroundColor: PALETTE.brand,
        borderRadius: 4,
      },
    ],
  };
}
