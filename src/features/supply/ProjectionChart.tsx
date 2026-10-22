"use client";

import { todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import type { Projection } from "./types";

export type Granularity = "day" | "week" | "month";

const DAY = 86400000;
const ms = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function ticks(from: number, to: number, g: Granularity): number[] {
  const out: number[] = [];
  const start = new Date(from);
  if (g === "month") {
    let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    while (d <= to) {
      if (d >= from - DAY) out.push(d);
      const x = new Date(d);
      d = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1);
    }
  } else if (g === "week") {
    let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) - ((start.getUTCDay() + 6) % 7) * DAY;
    while (d <= to) {
      if (d >= from - DAY) out.push(d);
      d += 7 * DAY;
    }
  } else {
    for (let d = from; d <= to; d += DAY) out.push(d);
  }
  const step = Math.max(1, Math.ceil(out.length / 12));
  return out.filter((_, i) => i % step === 0);
}

/** Projected balance over time for one item (REQ-SUP-UI-009). */
export function ProjectionChart({ proj, granularity = "week", width = 560, height = 170 }: { proj: Projection; granularity?: Granularity; width?: number; height?: number }) {
  const rt = useRuntime();
  const ev = proj.events;
  if (ev.length === 0) return <p className="muted">No supply or demand events for this item.</p>;

  const today = ms(todayIso(rt));
  const times = ev.map((e) => ms(e.on_date));
  const lo = Math.min(...times, today) - 2 * DAY;
  const hi = Math.max(...times) + 2 * DAY;
  const bals = [proj.opening_inventory, ...ev.map((e) => e.balance_after)];
  const minB = Math.min(0, ...bals);
  const maxB = Math.max(1, ...bals);
  const x = (t: number) => 46 + ((t - lo) / Math.max(hi - lo, 1)) * (width - 56);
  const y = (v: number) => 10 + ((maxB - v) / (maxB - minB || 1)) * (height - 44);

  let path = `M ${x(lo)} ${y(proj.opening_inventory)}`;
  let prev = proj.opening_inventory;
  for (const e of ev) {
    const px = x(ms(e.on_date));
    path += ` L ${px} ${y(prev)} L ${px} ${y(e.balance_after)}`;
    prev = e.balance_after;
  }
  path += ` L ${width - 10} ${y(prev)}`;
  const zero = y(0);
  const stock = proj.first_stockout_date ? ms(proj.first_stockout_date) : null;

  return (
    <svg width={width} height={height} className="sx-chart" role="img" aria-label={`Inventory projection for ${proj.item_no}`}>
      {ticks(lo, hi, granularity).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={10} y2={height - 34} stroke="#DFE4EB" />
          <text x={x(t)} y={height - 22} textAnchor="middle" fontSize={9} fill="#5B6B7C">
            {granularity === "month" ? new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : md(t)}
          </text>
        </g>
      ))}
      <line x1={46} x2={width - 10} y1={height - 34} y2={height - 34} stroke="#CADCFC" />
      <line x1={46} x2={width - 10} y1={zero} y2={zero} stroke="#8FADD6" strokeDasharray="4 3" />
      <text x={40} y={zero + 4} textAnchor="end" fontSize={10} fill="#5B6B7C">0</text>
      <text x={40} y={y(maxB) + 8} textAnchor="end" fontSize={10} fill="#5B6B7C">{Math.round(maxB)}</text>
      {minB < 0 && <text x={40} y={y(minB)} textAnchor="end" fontSize={10} fill="#dc2626">{Math.round(minB)}</text>}
      {minB < 0 && <rect x={46} y={zero} width={width - 56} height={height - 34 - zero} fill="#dc2626" opacity={0.06} />}
      <line x1={x(today)} x2={x(today)} y1={10} y2={height - 34} stroke="#0D2E52" strokeDasharray="2 3" />
      <text x={x(today) + 3} y={18} fontSize={8.5} fill="#0D2E52" fontWeight={700}>TODAY</text>
      <path d={path} fill="none" stroke={proj.first_stockout_date ? "#dc2626" : "#1B4A78"} strokeWidth={2} />
      {ev.map((e, i) => (
        <circle key={i} cx={x(ms(e.on_date))} cy={y(e.balance_after)} r={2.5} fill={e.kind === "demand" ? "#d97706" : e.kind === "recommended_po" ? "#16a34a" : "#1B4A78"}>
          <title>{`${e.on_date}  ${e.kind}  ${e.delta > 0 ? "+" : ""}${e.delta} → ${e.balance_after}  (${e.reference})`}</title>
        </circle>
      ))}
      {stock !== null && (
        <g>
          <line x1={x(stock)} x2={x(stock)} y1={10} y2={height - 34} stroke="#dc2626" strokeDasharray="2 3" />
          <text x={x(stock) + 3} y={28} fontSize={8.5} fill="#dc2626" fontWeight={700}>STOCKOUT {md(stock)}</text>
        </g>
      )}
    </svg>
  );
}
