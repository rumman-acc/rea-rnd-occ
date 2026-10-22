"use client";

import { Boxes, Download, Link2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { usePlan } from "@/state/PlanState";
import { getLinkage, getOrders, getSchedule, orderAction, type LinkageRow, type OrderRow, type SimInput } from "./api";
import { coverageStatus, downloadCsv, linkageCsv, ordersCsv, type CoverageStatus } from "./csv";
import { TableCard, Th, useSortFilter, type Col } from "./sortFilter";
import { errText, useLoad } from "./useLoad";
import "./production.css";

const healthLabel = (h: string | null) => (h === "green" ? "Safe" : h === "yellow" ? "Watch" : "At Risk");
const healthTone = (h: string | null) => (h === "green" ? "green" : h === "yellow" ? "yellow" : h === "red" ? "red" : "gray");

function Progress({ pct }: { pct: number }) {
  const cls = pct >= 80 ? "ok" : pct >= 40 ? "warn" : "bad";
  return (
    <div className="prd-progress">
      <div className="prd-progress__track">
        <div className={`prd-progress__fill prd-progress__fill--${cls}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="muted">{Math.round(pct)}%</span>
    </div>
  );
}

export function ProductionPage() {
  const { simMode, simOverrides, simNewOrders, refresh } = usePlan();
  const rt = useRuntime();
  const [tab, setTab] = useState<"orders" | "linkage">("orders");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("tab") === "linkage") {
      setTab("linkage");
      window.history.replaceState(null, "", "/production");
    }
  }, []);

  const sim: SimInput | undefined = useMemo(
    () =>
      simMode && (simOverrides.length > 0 || simNewOrders.length > 0)
        ? { overrides: simOverrides, new_orders: simNewOrders }
        : undefined,
    [simMode, simOverrides, simNewOrders],
  );
  const orders = useLoad(getOrders, []);
  const board = useLoad(() => getLinkage(sim), [sim]);

  const merged = useMemo<OrderRow[]>(() => {
    const byPo = new Map((board.data?.rows ?? []).filter((r) => r.prod_order_no).map((r) => [r.prod_order_no, r]));
    return (orders.data ?? [])
      .map((o) => {
        const b = byPo.get(o.po_number);
        return {
          ...o,
          customer_name: b?.customer_name || o.customer_name || "",
          start_date: b?.prod_start ?? o.start_date,
          end_date: b?.prod_end ?? o.end_date,
          pct_complete: b?.prod_pct_complete ?? o.pct_complete,
          delivery_date: b?.delivery_date ?? o.delivery_date,
          health: b ? b.health : o.health,
          linked: !!b || o.linked,
        };
      })
      .sort((a, b) => ((a.end_date ?? "9999") < (b.end_date ?? "9999") ? -1 : 1));
  }, [orders.data, board.data]);

  const rows = board.data?.rows ?? [];
  const units = merged.reduce((s, o) => s + o.quantity, 0);
  const sub =
    tab === "orders"
      ? `${merged.length} released orders (${merged.filter((o) => o.linked).length} linked to SOs) · ${formatUnits(units)} units remaining`
      : "1:1 coverage via BC reservation entries · buffer = SO delivery − PO end";

  const exportCsv = () =>
    tab === "orders"
      ? downloadCsv(`prod-orders-${todayIso(rt)}.csv`, ordersCsv(merged))
      : downloadCsv(`so-po-linkage-${todayIso(rt)}.csv`, linkageCsv(rows));

  return (
    <div>
      <PageHeader
        title="Production Orders"
        sub={sub}
        actions={
          <>
            <div className="prd-switch" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "is-active" : ""} onClick={() => setTab("orders")}>
                <Boxes size={13} aria-hidden="true" /> 1 · Orders
              </button>
              <button type="button" role="tab" aria-selected={tab === "linkage"} className={tab === "linkage" ? "is-active" : ""} onClick={() => setTab("linkage")}>
                <Link2 size={13} aria-hidden="true" /> 2 · SO ↔ PO Linkage
              </button>
            </div>
            <button type="button" className="btn btn--outline" onClick={exportCsv}>
              <Download size={13} aria-hidden="true" /> Export CSV
            </button>
            <Link href="/gantt" className="btn btn--outline">
              Gantt &amp; Simulate →
            </Link>
          </>
        }
      />
      {tab === "orders" ? (
        <>
          <OrdersTab rows={merged} loading={orders.loading} error={orders.error} today={todayIso(rt)} />
          <DemoActions onChanged={async () => { await orders.reload(); await board.reload(); await refresh(); }} />
        </>
      ) : board.error ? (
        <div className="notice notice--bad">{board.error}</div>
      ) : (
        <LinkageTab rows={rows} warnings={board.data?.warnings ?? []} loading={board.loading && !board.data} />
      )}
    </div>
  );
}

function OrdersTab({ rows, loading, error, today }: { rows: OrderRow[]; loading: boolean; error: string | null; today: string }) {
  const cols: Record<string, Col<OrderRow>> = {
    po: { get: (r) => r.po_number },
    customer: { get: (r) => r.customer_name },
    item: { get: (r) => r.item_no },
    series: { get: (r) => r.series },
    model: { get: (r) => r.model },
    start: { get: (r) => r.start_date ?? "" },
    end: { get: (r) => r.end_date ?? "" },
    remaining: { get: (r) => r.quantity, numeric: true, filter: false },
    progress: { get: (r) => r.pct_complete, numeric: true, filter: false },
    sodue: { get: (r) => r.delivery_date ?? "" },
    health: { get: (r) => (r.linked ? (r.health ?? "") : "unlinked") },
  };
  const sf = useSortFilter(rows, cols);
  return (
    <>
      {error && <div className="notice notice--bad prd-error">{error}</div>}
      <TableCard
        head={
          <>
            <Th sf={sf} id="po" label="PO #" />
            <Th sf={sf} id="customer" label="Customer" />
            <Th sf={sf} id="item" label="Item" />
            <Th sf={sf} id="series" label="Series" />
            <Th sf={sf} id="model" label="Model" />
            <Th sf={sf} id="start" label="Start" />
            <Th sf={sf} id="end" label="End" />
            <Th sf={sf} id="remaining" label="Remaining" right />
            <Th sf={sf} id="progress" label="Progress" />
            <Th sf={sf} id="sodue" label="SO Due" />
            <Th sf={sf} id="health" label="Health" />
          </>
        }
      >
        {sf.view.map((o) => {
          const overdue = o.end_date < today && o.pct_complete < 100;
          return (
            <tr key={o.po_number} className={overdue ? "prd-row--late" : undefined}>
              <td className="mono strong">{o.po_number}</td>
              <td className="prd-cust" title={o.customer_name}>{o.customer_name || <span className="muted">—</span>}</td>
              <td className="mono">{o.item_no}</td>
              <td>{o.series && <span className="pill pill--blue">{o.series}</span>}</td>
              <td>{o.model ? <span className="pill pill--navy">{o.model}</span> : <span className="muted">—</span>}</td>
              <td>{formatShortDate(o.start_date)}</td>
              <td className={overdue ? "overdue" : undefined}>{formatShortDate(o.end_date)}</td>
              <td className="num mono">{formatUnits(o.quantity)}</td>
              <td><Progress pct={o.pct_complete} /></td>
              <td>{o.delivery_date ? formatShortDate(o.delivery_date) : <span className="muted">—</span>}</td>
              <td>
                {o.linked && o.health ? <span className={`pill pill--${healthTone(o.health)}`}>{healthLabel(o.health)}</span> : <span className="pill pill--gray">Unlinked</span>}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={11} className="empty">
              {loading ? "Loading released production orders…" : "No released production orders."}
            </td>
          </tr>
        )}
      </TableCard>
    </>
  );
}

const STATUS_RANK: Record<CoverageStatus, number> = { "no-po": 0, late: 1, tight: 2, ok: 3 };

function LinkageTab({ rows, warnings, loading }: { rows: LinkageRow[]; warnings: Array<{ code: string }>; loading: boolean }) {
  const items = useMemo(
    () =>
      rows
        .map((r) => ({ r, status: coverageStatus(r) }))
        .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || ((a.r.delivery_date ?? "9999") < (b.r.delivery_date ?? "9999") ? -1 : 1)),
    [rows],
  );
  const count = (s: CoverageStatus) => items.filter((i) => i.status === s).length;
  const ok = count("ok"), tight = count("tight"), late = count("late"), noPo = count("no-po");
  const uncovered = items.filter((i) => i.status === "no-po").reduce((s, i) => s + i.r.quantity * i.r.unit_price, 0);
  const heuristic = warnings.filter((w) => w.code === "HEURISTIC_PROD_ORDER_LINK").length;

  type Item = (typeof items)[number];
  const cols: Record<string, Col<Item>> = {
    so: { get: (i) => i.r.so_number },
    customer: { get: (i) => i.r.customer_name },
    series: { get: (i) => i.r.series },
    model: { get: (i) => i.r.model },
    delivery: { get: (i) => i.r.delivery_date ?? "" },
    qty: { get: (i) => i.r.quantity, numeric: true, filter: false },
    po: { get: (i) => i.r.prod_order_no ?? "" },
    poend: { get: (i) => i.r.prod_end ?? "" },
    buffer: { get: (i) => i.r.buffer_days ?? 9999, numeric: true, filter: false },
    status: { get: (i) => i.status },
  };
  const sf = useSortFilter(items, cols);

  if (loading) return <div className="loading" role="status"><LoaderCircle className="spin" size={18} /> Loading…</div>;
  return (
    <>
      <div className="prd-kpis">
        <KpiCard label="On Track" value={ok} sub="PO ends before SO ship" tone="green" />
        <KpiCard label="Tight (<7d buffer)" value={tight} sub="monitor daily" tone="amber" />
        <KpiCard label="PO Late vs SO" value={late} sub="production ends after promise" tone="red" />
        <KpiCard label="No PO Linked" value={noPo} sub={`${formatMoney(uncovered)} uncovered`} tone="red" />
      </div>
      <div className="prd-intel" aria-label="Coverage Intelligence">
        <div className="prd-intel__title">✦ Coverage Intelligence</div>
        {noPo > 0 && (
          <div>
            ⚠ <b>{noPo}</b> sales order line(s) have no production order yet — {formatMoney(uncovered)} of revenue not covered by a production plan. Create and release the production orders; they link here automatically.
          </div>
        )}
        {late > 0 && (
          <div>
            🔴 <b>{late}</b> line(s) where production ends <b>after</b> the customer promise — reschedule or expedite.
          </div>
        )}
        {tight > 0 && (
          <div>
            🟡 <b>{tight}</b> line(s) with under a week of buffer.
          </div>
        )}
        {heuristic > 0 && <div>🔗 {heuristic} link(s) matched heuristically (same item, no reservation) — verify.</div>}
        {noPo + late + tight === 0 && <div className="prd-ok">✓ Every sales order has healthy production coverage.</div>}
      </div>
      <TableCard
        head={
          <>
            <Th sf={sf} id="so" label="SO #" />
            <Th sf={sf} id="customer" label="Customer" />
            <Th sf={sf} id="series" label="Series" />
            <Th sf={sf} id="model" label="Model" />
            <Th sf={sf} id="delivery" label="SO Delivery" />
            <Th sf={sf} id="qty" label="Qty" right />
            <Th sf={sf} id="po" label="Linked PO" />
            <Th sf={sf} id="poend" label="PO End" />
            <Th sf={sf} id="buffer" label="Buffer" />
            <Th sf={sf} id="status" label="Status" />
          </>
        }
      >
        {sf.view.map(({ r, status }) => (
          <tr key={`${r.so_number}-${r.item_no}`} className={status === "no-po" || status === "late" ? "prd-row--late" : status === "tight" ? "prd-row--tight" : undefined}>
            <td className="mono strong">{r.so_number}</td>
            <td className="prd-cust" title={r.customer_name ?? ""}>{r.customer_name || "—"}</td>
            <td>{r.series && <span className="pill pill--blue">{r.series}</span>}</td>
            <td>{r.model ? <span className="pill pill--navy">{r.model}</span> : <span className="muted">—</span>}</td>
            <td>{formatShortDate(r.delivery_date)}</td>
            <td className="num mono">{formatUnits(r.quantity)}</td>
            <td>{r.prod_order_no ? <span className="mono">{r.prod_order_no}</span> : <span className="muted">—</span>}</td>
            <td>{formatShortDate(r.prod_end)}</td>
            <td className={`prd-buf--${status === "no-po" || r.buffer_days === null ? "none" : status}`}>
              {r.buffer_days !== null ? `${r.buffer_days > 0 ? "+" : ""}${r.buffer_days}d` : "—"}
            </td>
            <td>
              {status === "no-po" ? <span className="pill pill--red">No PO</span> : status === "late" ? <span className="pill pill--red">PO Late</span> : status === "tight" ? <span className="pill pill--yellow">Tight</span> : <span className="pill pill--green">On Track</span>}
            </td>
          </tr>
        ))}
      </TableCard>
    </>
  );
}

/** Demo-only release/finish buttons (REQ-PRD-UI-020). The original releases orders in the ERP. */
function DemoActions({ onChanged }: { onChanged: () => Promise<void> }) {
  const sched = useLoad(() => getSchedule(), []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (sched.data?.orders ?? []).filter((o) => o.status !== "Finished");

  async function act(po: string, action: "release" | "finish") {
    setBusy(po);
    setErr(null);
    try {
      await orderAction(po, action);
      await sched.reload();
      await onChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="prd-demo">
      <Card title="Order actions (demo)">
        <p className="muted" style={{ marginTop: 0 }}>Demo actions — in the original, orders are created and released in the ERP.</p>
        {err && <div className="notice notice--bad prd-error">{err}</div>}
        <div className="table-scroll">
          <table className="dt" aria-label="Order actions">
            <thead>
              <tr><th>PO #</th><th>Item</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.po_number}>
                  <td className="mono strong">{o.po_number}</td>
                  <td className="mono">{o.fg_item_no}</td>
                  <td><span className={`pill pill--${o.status === "Released" ? "green" : "gray"}`}>{o.status}</span></td>
                  <td>
                    {o.status === "Planned" && <button type="button" className="btn btn--small" disabled={busy === o.po_number} onClick={() => act(o.po_number, "release")}>Release</button>}{" "}
                    {o.status === "Released" && <button type="button" className="btn btn--small" disabled={busy === o.po_number} onClick={() => act(o.po_number, "finish")}>Mark finished</button>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="empty">No open production orders.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
