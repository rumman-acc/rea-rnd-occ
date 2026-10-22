"use client";

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { barData, donutData, PALETTE } from "@/domain/chartModels";
import { healthCounts, seriesSummaries } from "@/domain/derive";
import type { StatusRow } from "@/domain/types";

ChartJS.register(ArcElement, BarElement, BarController, DoughnutController, CategoryScale, LinearScale, Tooltip, Legend);
ChartJS.defaults.font.size = 11;
ChartJS.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
ChartJS.defaults.color = PALETTE.chartText;

// Only these options are set; tooltip/hover/legend-toggle use library defaults (SPEC CHT-004).
const donutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: "bottom" as const } },
};

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
};

export function DonutChart({ rows }: { rows: readonly StatusRow[] }) {
  const c = healthCounts(rows);
  // Text alternative for assistive tech (SPEC NF-003; our addition).
  const label = `Order book health by line count: Safe ${c.green}, Watch ${c.yellow}, At Risk ${c.red}`;
  return (
    <div className="chart" role="img" aria-label={label}>
      <Doughnut data={donutData(rows)} options={donutOptions} />
    </div>
  );
}

export function BarChart({ rows }: { rows: readonly StatusRow[] }) {
  const label =
    "Open demand by series, units: " + seriesSummaries(rows).map((s) => `${s.series} ${s.total}`).join(", ");
  return (
    <div className="chart" role="img" aria-label={label}>
      <Bar data={barData(rows)} options={barOptions} />
    </div>
  );
}
