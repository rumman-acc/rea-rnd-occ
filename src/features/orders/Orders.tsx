"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { PricingWorkbench, SALES_PRICING, type PricingTab } from "@/features/pricing/Workbench";
import { csvCell, download, errText, Notice, Pill, Th, useTable } from "@/features/pricing/ui";
import { useRuntime } from "@/runtime/runtime";
import { usePlan } from "@/state/PlanState";
import { getSalesHistory, type SalesHistoryEntry } from "./api";
import "./orders.css";

type Tab = "open" | "history" | PricingTab;

const TABS: [Tab, string][] = [
  ["open", "1 · Open Orders"],
  ["history", "2 · Order History"],
  ["prices", "3 · Price Lists"],
  ["pricehistory", "4 · Price History"],
  ["priceaudit", "5 · Pricing Auditor"],
];

/** The /orders page: five tabs, the last three being the shared pricing workbench (sales domain). */
export function Orders() {
  const [tab, setTab] = useState<Tab>("open");
  const tabs = (
    <div className="pw-tabs" role="tablist" aria-label="Sales orders sections">
      {TABS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
  if (tab === "open") return <OpenOrders tabs={tabs} />;
  if (tab === "history") return <OrderHistory tabs={tabs} />;
  return <PricingWorkbench config={SALES_PRICING} tab={tab} tabs={tabs} onResumeReview={() => setTab("prices")} />;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000);
const healthLabel = (h: string) => (h === "green" ? "Safe" : h === "yellow" ? "Watch" : "At Risk");
const healthTone = (h: string) => (h === "green" ? "green" : h === "yellow" ? "yellow" : "red");

interface OpenRow {
  so: string;
  customer: string;
  item: string;
  description: string;
  series: string;
  model: string;
  delivery: string | null;
  days: number | null;
  ordered: number;
  open: number;
  value: number;
  po: string | null;
  health: string;
}

function OpenOrders({ tabs }: { tabs: React.ReactNode }) {
  const { effective, loading, plan } = usePlan();
  const rt = useRuntime();
  const today = todayIso(rt);
  const [detail, setDetail] = useState<Record<string, SalesHistoryEntry>>({});
  const [q, setQ] = useState("");

  useEffect(() => {
    getSalesHistory()
      .then((r) => setDetail(Object.fromEntries(r.entries.filter((e) => e.status === "open").map((e) => [e.so_number, e]))))
      .catch(() => setDetail({}));
  }, []);

  const rows = useMemo<OpenRow[]>(() => {
    const needle = q.trim().toLowerCase();
    return [...effective.status_board]
      .sort((a, b) => ((a.delivery_date ?? "9999") < (b.delivery_date ?? "9999") ? -1 : 1))
      .map((r) => {
        const d = detail[r.so_number];
        return {
          so: r.so_number,
          customer: r.customer_name ?? "",
          item: d?.item_no ?? r.item_no,
          description: d?.description ?? "",
          series: r.series ?? "",
          model: d?.model ?? "",
          delivery: r.delivery_date,
          days: r.delivery_date ? daysBetween(today, r.delivery_date) : null,
          ordered: d?.qty_ordered ?? r.quantity,
          open: r.quantity,
          value: r.quantity * r.unit_price,
          po: d?.prod_order_no ?? null,
          health: r.health,
        };
      })
      .filter((r) => !needle || [r.so, r.customer, r.item, r.series, r.model, r.description].some((x) => x.toLowerCase().includes(needle)));
  }, [effective.status_board, detail, q, today]);

  const t = useTable<OpenRow>(rows, {
    so: { get: (r) => r.so },
    customer: { get: (r) => r.customer },
    item: { get: (r) => `${r.item} ${r.description}` },
    series: { get: (r) => r.series },
    model: { get: (r) => r.model },
    delivery: { get: (r) => r.delivery ?? "" },
    days: { get: (r) => r.days ?? 99999, numeric: true, nofilter: true },
    shipped: { get: (r) => Math.max(0, r.ordered - r.open), numeric: true, nofilter: true },
    openqty: { get: (r) => r.open, numeric: true, nofilter: true },
    openval: { get: (r) => r.value, numeric: true, nofilter: true },
    po: { get: (r) => r.po ?? "" },
    health: { get: (r) => r.health },
  });

  const units = rows.reduce((n, r) => n + r.open, 0);
  const value = rows.reduce((n, r) => n + r.value, 0);

  return (
    <>
      <PageHeader
        title="Sales Orders"
        sub={`${rows.length} open MTO lines · ${formatUnits(units)} units · ${formatMoney(value)}`}
        actions={
          <>
            {tabs}
            <input className="input" style={{ width: 240 }} placeholder="Search SO, customer, item, model…" aria-label="Search sales orders" value={q} onChange={(e) => setQ(e.target.value)} />
            <button
              className="btn"
              onClick={() =>
                download(`sales-orders-${today}.csv`, [
                  "SO#,Customer,Item,Series,Model,DeliveryDate,QtyOrdered,QtyShipped,QtyOpen,UnitPrice,OpenValue,LinkedPO,Health",
                  ...t.view.map((r) => [r.so, csvCell(r.customer), r.item, r.series, csvCell(r.model), r.delivery ?? "", r.ordered, Math.max(0, r.ordered - r.open), r.open, r.open ? (r.value / r.open).toFixed(2) : 0, r.value.toFixed(2), r.po ?? "", r.health].join(",")),
                ])
              }
            >
              Export CSV
            </button>
          </>
        }
      />
      {loading && !plan && <div className="loading" role="status">Loading orders…</div>}
      <section className="card">
        <div className="table-scroll">
          <table className="dt pw-dt pw-nowrap" aria-label="Open sales orders">
            <thead>
              <tr>
                <Th t={t} id="so" label="SO #" />
                <Th t={t} id="customer" label="Customer" />
                <Th t={t} id="item" label="Item" />
                <Th t={t} id="series" label="Series" />
                <Th t={t} id="model" label="Model" />
                <Th t={t} id="delivery" label="Delivery" />
                <Th t={t} id="days" label="Days Out" />
                <Th t={t} id="shipped" label="Shipped" right />
                <Th t={t} id="openqty" label="Open Qty" right />
                <Th t={t} id="openval" label="Open Value" right />
                <Th t={t} id="po" label="Linked PO" />
                <Th t={t} id="health" label="Health" />
              </tr>
            </thead>
            <tbody>
              {t.view.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="muted" style={{ textAlign: "center", padding: 28 }}>
                    {rows.length === 0 ? "No open sales order lines." : "No rows match the filters."}
                  </td>
                </tr>
              )}
              {t.view.map((r, i) => {
                const late = r.days !== null && r.days < 0;
                const soon = r.days !== null && r.days >= 0 && r.days <= 7;
                const shipped = Math.max(0, r.ordered - r.open);
                return (
                  <tr key={`${r.so}-${i}`}>
                    <td className="pw-mono strong">{r.so}</td>
                    <td className="pw-clip" title={r.customer}>{r.customer || <span className="pw-dim">—</span>}</td>
                    <td className="pw-clip" title={`${r.item}: ${r.description}`}>
                      <span className="pw-mono">{r.item}</span> <span className="pw-small">{r.description}</span>
                    </td>
                    <td>{r.series && <Pill tone="blue">{r.series}</Pill>}</td>
                    <td>{r.model ? <Pill tone="navy">{r.model}</Pill> : <span className="pw-dim">—</span>}</td>
                    <td className={late ? "pw-down" : soon ? "orders-soon" : ""}>{formatShortDate(r.delivery)}</td>
                    <td className={late ? "pw-down strong" : soon ? "orders-soon" : "pw-small"}>{r.days === null ? "—" : late ? `${Math.abs(r.days)}d late` : `${r.days}d`}</td>
                    <td className="num pw-mono" title={`${shipped} of ${r.ordered} ordered units shipped`}>
                      <span className={shipped > 0 ? "pw-up strong" : "pw-dim"}>{shipped}</span>
                      <span className="pw-dim"> / {r.ordered}</span>
                    </td>
                    <td className="num pw-mono">{formatUnits(r.open)}</td>
                    <td className="num pw-mono">{formatMoney(r.value)}</td>
                    <td>{r.po ? <span className="pw-mono" style={{ color: "var(--brand)" }}>{r.po}</span> : <span className="pw-down strong pw-small">None</span>}</td>
                    <td><Pill tone={healthTone(r.health)}>{healthLabel(r.health)}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

interface Group {
  key: string;
  title: string;
  subtitle: string;
  orders: number;
  qo: number;
  qs: number;
  ao: number;
  as: number;
  entries: SalesHistoryEntry[];
}

function OrderHistory({ tabs }: { tabs: React.ReactNode }) {
  const [entries, setEntries] = useState<SalesHistoryEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [by, setBy] = useState<"customer" | "fg">("customer");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    getSalesHistory().then((r) => setEntries(r.entries)).catch((e) => setErr(errText(e)));
  }, []);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const e of entries ?? []) {
      const key = by === "customer" ? e.customer_name || e.customer_no || "Unknown customer" : e.item_no;
      const g = m.get(key) ?? { key, title: key, subtitle: by === "customer" ? e.customer_no : `${e.description}${e.model ? ` · ${e.model}` : ""}`, orders: 0, qo: 0, qs: 0, ao: 0, as: 0, entries: [] };
      g.qo += e.qty_ordered;
      g.qs += e.qty_shipped;
      g.ao += e.amount_ordered;
      g.as += e.amount_shipped;
      g.entries.push(e);
      m.set(key, g);
    }
    const out = [...m.values()];
    for (const g of out) g.orders = new Set(g.entries.map((e) => e.so_number)).size;
    return out.sort((a, b) => b.as - a.as || b.ao - a.ao);
  }, [entries, by]);

  const t = useTable<Group>(groups, {
    who: { get: (g) => `${g.title} ${g.subtitle} ${g.entries.map((e) => e.so_number).join(" ")}` },
    orders: { get: (g) => g.orders, numeric: true },
    qo: { get: (g) => g.qo, numeric: true },
    qs: { get: (g) => g.qs, numeric: true },
    ao: { get: (g) => g.ao, numeric: true },
    as: { get: (g) => g.as, numeric: true },
    bal: { get: (g) => g.ao - g.as, numeric: true },
  });
  const tot = (entries ?? []).reduce((n, e) => ({ orders: n.orders.add(e.so_number), qo: n.qo + e.qty_ordered, qs: n.qs + e.qty_shipped, ao: n.ao + e.amount_ordered, as: n.as + e.amount_shipped }), { orders: new Set<string>(), qo: 0, qs: 0, ao: 0, as: 0 });
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <PageHeader
        title="Sales Order History"
        sub={entries ? `${tot.orders.size} orders · ordered ${formatUnits(tot.qo)}u / ${formatMoney(tot.ao)} · shipped ${formatUnits(tot.qs)}u / ${formatMoney(tot.as)}` : "Posted invoices merged with the open order book"}
        actions={
          <>
            {tabs}
            <div className="pw-seg" role="group" aria-label="Group by">
              <button className={by === "customer" ? "is-active" : ""} onClick={() => { setBy("customer"); setOpen(new Set()); }}>By Customer</button>
              <button className={by === "fg" ? "is-active" : ""} onClick={() => { setBy("fg"); setOpen(new Set()); }}>By Finished Good</button>
            </div>
            <button
              className="btn" disabled={!entries}
              onClick={() =>
                download("sales-order-history.csv", [
                  "SO#,Customer,Item,Description,Series,Model,PromisedDate,FirstShip,LastShip,QtyOrdered,QtyShipped,AmtOrdered,AmtShipped,Status",
                  ...(entries ?? []).map((e) => [e.so_number, csvCell(e.customer_name), e.item_no, csvCell(e.description), e.series, csvCell(e.model), e.promised_date ?? "", e.first_invoice_date ?? "", e.last_invoice_date ?? "", e.qty_ordered, e.qty_shipped, e.amount_ordered, e.amount_shipped, e.status].join(",")),
                ])
              }
            >
              Export CSV
            </button>
          </>
        }
      />
      {err && <Notice tone="bad">{err}</Notice>}
      {!entries && !err && <div className="loading" role="status">Loading posted invoices…</div>}
      {entries && (
        <section className="card">
          <div className="table-scroll">
            <table className="dt pw-dt" aria-label="Sales order history">
              <thead>
                <tr>
                  <Th t={t} id="who" label={by === "customer" ? "Customer" : "Finished Good"} />
                  <Th t={t} id="orders" label="Orders" right />
                  <Th t={t} id="qo" label="Qty Ordered" right />
                  <Th t={t} id="qs" label="Qty Shipped" right />
                  <Th t={t} id="ao" label="Amount Ordered" right />
                  <Th t={t} id="as" label="Amount Shipped" right />
                  <Th t={t} id="bal" label="Open Balance" right />
                </tr>
              </thead>
              <tbody>
                {t.view.map((g) => (
                  <GroupRows key={g.key} g={g} by={by} open={open.has(g.key)} onToggle={() => toggle(g.key)} />
                ))}
                <tr className="pw-navy strong">
                  <td>TOTAL</td>
                  <td className="num">{tot.orders.size}</td>
                  <td className="num">{formatUnits(tot.qo)}</td>
                  <td className="num">{formatUnits(tot.qs)}</td>
                  <td className="num">{formatMoney(tot.ao)}</td>
                  <td className="num">{formatMoney(tot.as)}</td>
                  <td className="num">{formatMoney(tot.ao - tot.as)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function GroupRows({ g, by, open, onToggle }: { g: Group; by: "customer" | "fg"; open: boolean; onToggle: () => void }) {
  const sorted = useMemo(() => [...g.entries].sort((a, b) => ((b.last_invoice_date ?? b.promised_date ?? "") < (a.last_invoice_date ?? a.promised_date ?? "") ? -1 : 1)), [g.entries]);
  const bal = g.ao - g.as;
  return (
    <>
      <tr style={{ cursor: "pointer", background: "var(--surface2)" }} onClick={onToggle} aria-expanded={open} data-testid="history-group">
        <td className="strong">
          {open ? "▾" : "▸"} {g.title} <span className="pw-small">{g.subtitle}</span>
        </td>
        <td className="num pw-mono">{g.orders}</td>
        <td className="num pw-mono strong">{formatUnits(g.qo)}</td>
        <td className="num pw-mono">{formatUnits(g.qs)}</td>
        <td className="num pw-mono strong">{formatMoney(g.ao)}</td>
        <td className="num pw-mono">{formatMoney(g.as)}</td>
        <td className={`num pw-mono ${bal > 0.005 ? "strong" : "pw-dim"}`}>{formatMoney(bal)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>SO #</th><th>{by === "customer" ? "Finished Good" : "Customer"}</th><th>Model</th><th>Promised</th><th>First Ship</th><th>Last Ship</th>
                  <th>Qty Ord.</th><th>Qty Shipped</th><th>Amt Ordered</th><th>Amt Shipped</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e, i) => (
                  <tr key={`${e.so_number}-${e.item_no}-${i}`}>
                    <td className="pw-mono strong">{e.so_number}</td>
                    <td>{by === "customer" ? <><span className="pw-mono">{e.item_no}</span> <span className="pw-small">{e.description}</span></> : e.customer_name || "—"}</td>
                    <td>{e.model ? <Pill tone="navy">{e.model}</Pill> : "—"}</td>
                    <td>{formatShortDate(e.promised_date)}</td>
                    <td>{formatShortDate(e.first_invoice_date)}</td>
                    <td>{formatShortDate(e.last_invoice_date)}</td>
                    <td className="num pw-mono">{formatUnits(e.qty_ordered)}</td>
                    <td className="num pw-mono">{formatUnits(e.qty_shipped)}</td>
                    <td className="num pw-mono">{formatMoney(e.amount_ordered)}</td>
                    <td className="num pw-mono">{formatMoney(e.amount_shipped)}</td>
                    <td><Pill tone={e.status === "completed" ? "green" : "blue"}>{e.status === "completed" ? "Completed" : "Open"}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
