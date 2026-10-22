"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { usePlan } from "@/state/PlanState";
import { getFgCatalog, getSupplyDetail, getSupplyStatuses } from "@/features/supply/api";
import { CreatePoModal, Modal } from "@/features/supply/CreatePoModal";
import { downloadCsv } from "@/features/supply/csv";
import { HorizonSelect, useTodayStamp } from "@/features/supply/HorizonSelect";
import { SfTh, useSortFilter } from "@/features/supply/useSortFilter";
import type { FgEntry, Health, SupplyComponent, SupplyDetail, VendorSummary } from "@/features/supply/types";
import "@/features/supply/supply.css";

const DOT: Record<string, string> = { red: "🔴", yellow: "🟡", green: "🟢" };
const BADGE = { red: ["pill pill--red", "✕ CRITICAL"], yellow: ["pill pill--yellow", "! LOW"], green: ["pill pill--green", "✓ COVERED"] } as const;
const STATUS = { red: ["pill pill--red", "✕ RED"], yellow: ["pill pill--yellow", "! LOW"], green: ["pill pill--green", "✓ GREEN"] } as const;

type Drill = { kind: "so" | "res" | "po"; comp?: SupplyComponent } | null;

function exportCsv(d: SupplyDetail, stamp: string) {
  const lines = ["FG,Component,Description,Level,SubAssembly,QtyPerUnit,Required,OnHand,Reserved,OnPO,PO_ETA,NetAvailable,Status,Vendor,LeadTimeDays,LastDirectCost"];
  for (const c of d.components) {
    lines.push(
      [
        d.fg_item_no, c.item_no, `"${c.description}"`, c.level, c.is_subassembly ? "yes" : "no", c.qty_per_unit, c.required, c.on_hand,
        c.reserved ?? "", c.on_po ?? "", c.po_eta ?? "", c.is_subassembly ? "" : c.net_available,
        c.is_subassembly ? "manufactured" : c.status, `"${c.vendor_name || c.vendor_no || ""}"`, c.lead_time_days ?? "", c.last_direct_cost ?? "",
      ].join(","),
    );
  }
  downloadCsv(`replenishment-${d.fg_item_no}-${stamp}.csv`, lines);
}

export function Replenishment() {
  const { plan, loading, refresh } = usePlan();
  const rt = useRuntime();
  const stamp = useTodayStamp();
  const [fg, setFg] = useState("");
  const [detail, setDetail] = useState<SupplyDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState("auto");
  const [statuses, setStatuses] = useState<Record<string, Health>>({});
  const [catalog, setCatalog] = useState<FgEntry[]>([]);
  const [drill, setDrill] = useState<Drill>(null);
  const [poComp, setPoComp] = useState<SupplyComponent | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const pending = useRef<{ fg: string | null; item: string | null; highlight: string | null }>({ fg: null, item: null, highlight: null });
  const [reload, setReload] = useState(0);

  const withDemand = useMemo(() => catalog.filter((f) => f.demand_source !== "none"), [catalog]);
  const groups = useMemo(() => {
    const m = new Map<string, FgEntry[]>();
    for (const f of withDemand) {
      const k = f.series || "Unclassified";
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "Unclassified" ? 1 : b === "Unclassified" ? -1 : a.localeCompare(b)));
  }, [withDemand]);

  const load = useCallback(async (item: string) => {
    setBusy(true);
    try {
      const d = await getSupplyDetail(item);
      setDetail(d);
      const { item: openItem, highlight: hl } = pending.current;
      pending.current = { fg: null, item: null, highlight: null };
      if (openItem) {
        const c = d.components.find((x) => x.item_no === openItem && !x.is_subassembly);
        if (c) setPoComp(c);
      }
      if (hl) setHighlight(hl);
    } catch {
      setDetail(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Query parameters are read once on mount, then removed from the address (REQ-REP-UI-007).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = { fg: sp.get("fg"), item: sp.get("item"), highlight: sp.get("highlight") };
    if (q.fg || q.item || q.highlight) {
      pending.current = q;
      window.history.replaceState(null, "", window.location.pathname);
      if (q.fg) setFg(q.fg);
    }
  }, []);
  useEffect(() => {
    if (!fg && withDemand.length && !pending.current.fg) setFg(withDemand[0].item_no);
  }, [withDemand, fg]);
  useEffect(() => {
    if (fg) {
      setDetail(null);
      void load(fg);
    }
  }, [fg, load, reload]);
  useEffect(() => {
    getSupplyStatuses().then(setStatuses).catch(() => {});
    getFgCatalog().then(setCatalog).catch(() => {});
  }, [reload]);

  const comps = useSortFilter<SupplyComponent>(detail?.components ?? [], {
    item: { get: (c) => c.item_no, sort: false },
    desc: { get: (c) => c.description, sort: false },
    status: { get: (c) => (c.is_subassembly ? "manufactured" : c.status), sort: false },
  });
  const vendors = useSortFilter<VendorSummary>(detail?.vendor_summary ?? [], {
    vendor: { get: (v) => `${v.name} ${v.vendor_no}` },
    parts: { get: (v) => v.parts.join(" ") },
    lead: { get: (v) => v.max_lead_time_days, numeric: true },
    rel: { get: (v) => v.reliability_pct ?? -1, numeric: true },
  });

  if (loading && !plan) return <div className="loading">Loading…</div>;
  if (!plan) return null;
  const today = todayIso(rt);
  const overall = detail?.overall ?? "green";

  return (
    <div>
      <PageHeader
        title="Supply Detail & Replenishment"
        sub="Component-level inventory, purchase orders and net availability per finished good — click any number to drill down"
        actions={detail ? <button type="button" className="btn" onClick={() => exportCsv(detail, stamp)}>Export CSV</button> : undefined}
      />
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__body toolbar" style={{ marginBottom: 0 }}>
          <b className="sx-sub">Select FG:</b>
          <select className="select" aria-label="Select FG" value={fg} onChange={(e) => setFg(e.target.value)}>
            {groups.map(([series, list]) => (
              <optgroup key={series} label={series === "Unclassified" ? "Unclassified" : `${series} series`}>
                {list.map((f) => {
                  const st = statuses[f.item_no] ?? (f.item_no === detail?.fg_item_no ? detail.overall : null);
                  const suffix = f.demand_source === "plan" ? " · S&OP plan" : f.demand_source === "both" ? " · orders + plan" : "";
                  return (
                    <option key={f.item_no} value={f.item_no}>{`${st ? DOT[st] : "⚪"} ${f.item_no} — ${f.description}${suffix}`}</option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <span className="sx-sub">{withDemand.length} finished good(s) with demand</span>
          <span className="toolbar__spacer" />
          <HorizonSelect value={horizon} onChange={setHorizon} />
        </div>
      </section>

      {detail && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__body sx-head" style={{ marginBottom: 0 }}>
            <span className="sx-chip">{detail.fg_item_no}</span>
            <div>
              <div className="sx-title">{detail.description}</div>
              <div className="sx-sub">
                {detail.customers.join(", ") || (detail.planned_demand ? "no customer orders" : "—")} ·{" "}
                <button type="button" className="sx-link" onClick={() => setDrill({ kind: "so" })}>{formatUnits(detail.total_demand)} units total demand</button>{" "}
                {(detail.planned_demand ?? 0) > 0 && (
                  <span title="From the S&OP item-level firm plan — no sales order behind it">
                    (<b>{formatUnits(detail.bc_demand)}</b> ordered + <b>{formatUnits(detail.planned_demand)} planned</b>){" "}
                  </span>
                )}
                · Series: {detail.series || "—"}
                {detail.model && <> · Model: <b>{detail.model}</b></>}
              </div>
            </div>
            <span className={BADGE[overall][0]}>{BADGE[overall][1]}</span>
          </div>
        </section>
      )}

      <div style={{ marginBottom: 16 }}>
        <Card
          title="Bill of Materials — Component Supply Status"
          bodyClassName="sx-wide"
          actions={detail && <span className="sx-sub">NC Risk adjustment: <b>{detail.nc_risk_pct}%</b> · Total demand: <b>{formatUnits(detail.total_demand)} units</b></span>}
        >
          {busy && <p className="muted">Netting components against current inventory…</p>}
          {!busy && detail && (
            <table className="dt">
              <thead>
                <tr>
                  <SfTh sf={comps} id="item" label="Component" />
                  <SfTh sf={comps} id="desc" label="Description" />
                  <th className="num">Qty/Unit</th>
                  <th className="num">Required</th>
                  <th className="num">On Hand</th>
                  <th className="num">Reserved</th>
                  <th className="num">On PO</th>
                  <th>PO ETA</th>
                  <th className="num">Net Available</th>
                  <SfTh sf={comps} id="status" label="Status" />
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {comps.view.map((c, i) =>
                  c.is_subassembly ? (
                    <tr key={`${c.item_no}-${i}`} className="sx-sub-row">
                      <td colSpan={2} className="mono strong">
                        <span style={{ paddingLeft: (c.level - 1) * 18 }}>
                          ▸ {c.item_no} <span className="sx-sub">{c.description}</span> <span className="pill sx-pill-navy">Sub-assembly · manufactured</span>
                        </span>
                      </td>
                      <td className="num mono">{formatUnits(c.qty_per_unit)}</td>
                      <td className="num mono">{formatUnits(c.required)}</td>
                      <td className="num mono">{formatUnits(c.on_hand)}</td>
                      <td colSpan={6} className="muted"><i>produced in-house — see production orders</i></td>
                    </tr>
                  ) : (
                    <tr
                      key={`${c.item_no}-${i}`}
                      ref={c.item_no === highlight ? (el) => el?.scrollIntoView?.({ behavior: "smooth", block: "center" }) : undefined}
                      className={c.item_no === highlight ? "sx-hl" : c.status === "red" ? "row--red" : c.status === "yellow" ? "row--yellow" : ""}
                      data-highlight={c.item_no === highlight ? "true" : undefined}
                    >
                      <td className="mono strong"><span style={{ paddingLeft: (c.level - 1) * 18 }}>{c.item_no}</span></td>
                      <td className="truncate" style={{ maxWidth: 230 }}>{c.description}</td>
                      <td className="num mono">{formatUnits(c.qty_per_unit)}</td>
                      <td className="num"><button type="button" className="sx-link mono" onClick={() => setDrill({ kind: "so", comp: c })}>{formatUnits(c.required)}</button></td>
                      <td className="num mono">{formatUnits(c.on_hand)}</td>
                      <td className="num">{c.reserved > 0 ? <button type="button" className="sx-link mono" onClick={() => setDrill({ kind: "res", comp: c })}>{formatUnits(c.reserved)}</button> : <span className="muted">—</span>}</td>
                      <td className="num">{c.on_po > 0 ? <button type="button" className="sx-link mono" onClick={() => setDrill({ kind: "po", comp: c })}>{formatUnits(c.on_po)}</button> : <span className="muted">—</span>}</td>
                      <td>{formatShortDate(c.po_eta)}</td>
                      <td className={`num mono strong ${c.net_available < 0 ? "sx-bad" : "sx-ok"}`}>{c.net_available > 0 ? "+" : ""}{formatUnits(c.net_available)}</td>
                      <td><span className={STATUS[c.status][0]}>{STATUS[c.status][1]}</span></td>
                      <td>
                        <button type="button" className={c.status === "red" ? "btn btn--danger" : c.status === "yellow" ? "btn btn--primary" : "btn"} onClick={() => setPoComp(c)}>
                          Create PO
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {!busy && !detail && <p className="muted">Could not load supply detail.</p>}
        </Card>
      </div>

      {detail && detail.vendor_summary.length > 0 && (
        <Card title="Vendor Summary — parts requiring orders" bodyClassName="sx-wide">
          <table className="dt">
            <thead>
              <tr>
                <SfTh sf={vendors} id="vendor" label="Vendor" />
                <SfTh sf={vendors} id="parts" label="Parts" />
                <SfTh sf={vendors} id="lead" label="Lead Time" />
                <SfTh sf={vendors} id="rel" label="Reliability" />
                <th className="num">Purchase Price (item card)</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {vendors.view.map((v) => (
                <tr key={v.vendor_no}>
                  <td>
                    <b>{v.name}</b> <span className="mono sx-sub">{v.vendor_no !== "UNASSIGNED" ? v.vendor_no : ""}</span>
                  </td>
                  <td>{v.parts.map((p) => <Fragment key={p}><span className="pill pill--gray">{p}</span>{" "}</Fragment>)}</td>
                  <td>{v.max_lead_time_days > 0 ? `${v.max_lead_time_days}d` : <span className="muted">no profile</span>}</td>
                  <td>
                    {v.reliability_pct !== null ? (
                      <span title={`On-time delivery, ${v.reliability_source || "open lines"}; avg ${v.avg_overdue_days}d late when late`}>
                        <span className="sx-bar"><span className={v.reliability_pct >= 95 ? "sx-bar--ok" : v.reliability_pct >= 80 ? "sx-bar--warn" : "sx-bar--bad"} style={{ width: `${v.reliability_pct}%` }} /></span>{" "}
                        <b>{v.reliability_pct}%</b>
                        {v.reliability_source.startsWith("history") && <span className="muted"> 12m</span>}
                      </span>
                    ) : (
                      <span className="muted" title="No receipt history or open PO lines to measure">n/a</span>
                    )}
                  </td>
                  <td className="num mono">{Object.entries(v.prices).map(([k, p]) => <div key={k}>{k}: {formatMoney(p)}</div>)}</td>
                  <td>{v.contact || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {drill && detail && <DrillDialog drill={drill} detail={detail} today={today} onClose={() => setDrill(null)} />}
      {poComp && detail && (
        <CreatePoModal
          comp={poComp}
          fg={detail.fg_item_no}
          horizon={horizon}
          onClose={() => setPoComp(null)}
          onCreated={() => {
            setPoComp(null);
            void refresh();
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function Table({ head, children, num = [] }: { head: string[]; children: ReactNode; num?: number[] }) {
  return (
    <table className="dt">
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={num.includes(i) ? "num" : undefined}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function DrillDialog({ drill, detail, today, onClose }: { drill: NonNullable<Drill>; detail: SupplyDetail; today: string; onClose: () => void }) {
  const a = drill.comp;
  const title =
    drill.kind === "so" ? `Demand — sales orders for ${detail.fg_item_no}${a ? ` (drives ${a.item_no})` : ""}`
    : drill.kind === "res" ? `Reservations — ${a?.item_no}`
    : `Open purchase orders — ${a?.item_no}`;
  return (
    <Modal title={title} onClose={onClose}>
      {drill.kind === "so" && (
        <Table head={["SO #", "Customer", "Qty", ...(a ? ["Component need"] : []), "Delivery", "Value"]} num={a ? [2, 3, 5] : [2, 4]}>
          {detail.sales_orders.map((s, i) => (
            <tr key={i}>
              <td>{s.is_planned ? <span className="pill pill--blue">S&OP plan</span> : <b className="mono">{s.so_number}</b>}</td>
              <td>{s.customer_name || "—"}</td>
              <td className="num mono">{formatUnits(s.quantity)}</td>
              {a && <td className="num mono">{formatUnits(s.quantity * a.qty_per_unit)}</td>}
              <td>{formatShortDate(s.delivery_date)}</td>
              <td className="num mono">{formatMoney(s.value)}</td>
            </tr>
          ))}
        </Table>
      )}
      {drill.kind === "res" && a && (a.reservations.length ? (
        <Table head={["Reserved for", "Qty"]} num={[1]}>
          {a.reservations.map((r, i) => <tr key={i}><td>{r.reserved_for}</td><td className="num mono">{formatUnits(r.qty)}</td></tr>)}
        </Table>
      ) : <p className="muted">No reservation entries for this item.</p>)}
      {drill.kind === "po" && a && (a.open_pos.length ? (
        <Table head={["PO #", "Vendor", "Outstanding", "ETA"]} num={[2]}>
          {a.open_pos.map((p, i) => {
            const late = !!p.eta && p.eta < today;
            return (
              <tr key={i}>
                <td className="mono strong">{p.po_number}</td>
                <td className="mono">{p.vendor_no || "—"}</td>
                <td className="num mono">{formatUnits(p.qty)}</td>
                <td className={late ? "sx-overdue" : ""}>{formatShortDate(p.eta)}{late ? " (overdue)" : ""}</td>
              </tr>
            );
          })}
        </Table>
      ) : <p className="muted">No open purchase order lines for this item.</p>)}
    </Modal>
  );
}
