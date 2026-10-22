"use client";

import { Fragment, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { getCosting, getWorkCenters, putLaborRates, type CostItem } from "@/features/production/api";
import { EvidenceNotice, errText, useLoad } from "@/features/production/useLoad";
import "@/features/production/production.css";

const money = (v: number | null) => (v === null ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const marginTone = (p: number | null) => (p === null ? "gray" : p < 10 ? "red" : p < 25 ? "yellow" : "green");

type SortKey = "item_no" | "total_cost" | "margin" | "margin_pct";

export function CostingPage() {
  const costing = useLoad(getCosting, []);
  const wcs = useLoad(getWorkCenters, []);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const items = costing.data?.items ?? [];
  const sorted = sort
    ? [...items].sort((a, b) => (sort.key === "item_no" ? a.item_no.localeCompare(b.item_no) : (a[sort.key] ?? -1e12) - (b[sort.key] ?? -1e12)) * sort.dir)
    : items;
  const withMargin = items.filter((i) => i.margin_pct !== null);
  const avg = withMargin.length ? withMargin.reduce((s, i) => s + (i.margin_pct ?? 0), 0) / withMargin.length : null;
  const lowest = withMargin.reduce<CostItem | null>((m, i) => (!m || (i.margin_pct ?? 0) < (m.margin_pct ?? 0) ? i : m), null);
  const arrow = (k: SortKey) => (sort?.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const toggle = (key: SortKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div>
      <PageHeader title="Product Costing" sub="standard cost roll-up per finished good" />
      <EvidenceNotice />
      <div className="prd-section" />
      {costing.error && <div className="notice notice--bad prd-error">{costing.error}</div>}
      {costing.loading && !costing.data && <div className="loading" role="status">Loading costing…</div>}
      {costing.data && (
        <>
          <div className="prd-cards">
            <KpiCard label="Products costed" value={items.length} sub="finished goods" tone="blue" />
            <KpiCard label="Average margin" value={avg === null ? "—" : `${avg.toFixed(1)}%`} sub="vs latest sales price" tone="blue" />
            <KpiCard label="Lowest margin" value={lowest ? `${lowest.margin_pct}%` : "—"} sub={lowest ? lowest.item_no : "no priced items"} tone={lowest && (lowest.margin_pct ?? 0) < 10 ? "red" : "amber"} />
            <KpiCard label="Overhead rate" value={`${costing.data.overhead_pct}%`} sub="of labor cost" tone="blue" />
          </div>
          <section className="card">
            <div className="table-scroll">
              <table className="dt" aria-label="Product costs">
                <thead>
                  <tr>
                    <th><button type="button" className="orders__sort" onClick={() => toggle("item_no")}>Item{arrow("item_no")}</button></th>
                    <th>Description</th>
                    <th>Series</th>
                    <th className="right">Material</th>
                    <th className="right">Labor</th>
                    <th className="right">Overhead</th>
                    <th className="right"><button type="button" className="orders__sort" onClick={() => toggle("total_cost")}>Total cost{arrow("total_cost")}</button></th>
                    <th className="right">Sales price</th>
                    <th className="right"><button type="button" className="orders__sort" onClick={() => toggle("margin")}>Margin{arrow("margin")}</button></th>
                    <th className="right"><button type="button" className="orders__sort" onClick={() => toggle("margin_pct")}>Margin %{arrow("margin_pct")}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((i) => (
                    <Fragment key={i.item_no}>
                      <tr onClick={() => setOpen(open === i.item_no ? null : i.item_no)} style={{ cursor: "pointer" }} aria-expanded={open === i.item_no}>
                        <td className="mono strong">{i.item_no}</td>
                        <td>{i.description}</td>
                        <td><span className="pill pill--blue">{i.series}</span></td>
                        <td className="num">{money(i.material_cost)}</td>
                        <td className="num">{money(i.labor_cost)}</td>
                        <td className="num">{money(i.overhead_cost)}</td>
                        <td className="num strong">{money(i.total_cost)}</td>
                        <td className="num">{money(i.sales_price)}</td>
                        <td className="num">{money(i.margin)}</td>
                        <td className="num"><span className={`pill pill--${marginTone(i.margin_pct)}`}>{i.margin_pct === null ? "—" : `${i.margin_pct}%`}</span></td>
                      </tr>
                      {open === i.item_no && (
                        <tr>
                          <td colSpan={10}>
                            <div className="grid-2">
                              <table className="dt" aria-label={`Material breakdown ${i.item_no}`}>
                                <thead><tr><th>Component</th><th className="right">Qty per</th><th className="right">Unit cost</th><th className="right">Extended</th></tr></thead>
                                <tbody>
                                  {i.components.map((c) => (
                                    <tr key={c.item_no}><td>{c.item_no} {c.description}</td><td className="num">{c.qty_per}</td><td className="num">{money(c.unit_cost)}</td><td className="num">{money(c.extended)}</td></tr>
                                  ))}
                                  {i.components.length === 0 && <tr><td colSpan={4} className="empty">No bill of materials.</td></tr>}
                                </tbody>
                              </table>
                              <table className="dt" aria-label={`Labor breakdown ${i.item_no}`}>
                                <thead><tr><th>Work center</th><th className="right">Hours / unit</th><th className="right">Rate</th><th className="right">Extended</th></tr></thead>
                                <tbody>
                                  {i.operations.map((o) => (
                                    <tr key={o.work_center}><td>{o.work_center} {o.name}</td><td className="num">{o.hours}</td><td className="num">{money(o.rate)}</td><td className="num">{money(o.extended)}</td></tr>
                                  ))}
                                  {i.operations.length === 0 && <tr><td colSpan={4} className="empty">No routing.</td></tr>}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {items.length === 0 && <tr><td colSpan={10} className="empty">No finished goods to cost.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {costing.data && wcs.data && (
        <div className="prd-section">
          <RatesCard
            centers={wcs.data}
            overhead={costing.data.overhead_pct}
            onSaved={async () => { await costing.reload(); await wcs.reload(); }}
          />
        </div>
      )}
    </div>
  );
}

function RatesCard({ centers, overhead, onSaved }: { centers: Array<{ code: string; name: string; labor_rate: number }>; overhead: number; onSaved: () => Promise<void> }) {
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(centers.map((w) => [w.code, String(w.labor_rate)])));
  const [oh, setOh] = useState(String(overhead));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setMsg(null), [rates, oh]);

  async function save() {
    try {
      await putLaborRates(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v)])), Number(oh));
      await onSaved();
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  }
  return (
    <Card title="Labor rates & overhead">
      <div className="prd-form">
        {centers.map((w) => (
          <label key={w.code} className="field">
            {w.name} ($/h)
            <input className="input" inputMode="decimal" value={rates[w.code] ?? ""} onChange={(e) => setRates({ ...rates, [w.code]: e.target.value })} />
          </label>
        ))}
        <label className="field">
          Overhead (% of labor)
          <input className="input" inputMode="decimal" value={oh} onChange={(e) => setOh(e.target.value)} />
        </label>
        <button type="button" className="btn btn--primary" onClick={save}>Save rates</button>
        {msg && <span className={msg.ok ? "prd-saved" : "notice notice--bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
      </div>
    </Card>
  );
}
