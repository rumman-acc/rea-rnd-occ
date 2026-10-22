"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/Card";
import { formatShortDate, formatUnits } from "@/domain/format";
import { usePlan } from "@/state/PlanState";
import { getSupplyDetail, getSupplyNetting, getSupplyStatuses } from "./api";
import { CreatePoModal } from "./CreatePoModal";
import { downloadCsv } from "./csv";
import { HorizonSelect, useTodayStamp } from "./HorizonSelect";
import { nettingRows, supplyCsv, type NettingRow } from "./netting";
import { ProjectionChart, type Granularity } from "./ProjectionChart";
import { SfTh, useSortFilter } from "./useSortFilter";
import type { Health, Netting, NettingOrder, SupplyComponent, SupplyDetail } from "./types";
import "./supply.css";

export const DOT: Record<Health, string> = { red: "🔴", yellow: "🟡", green: "🟢" };

function orderLabel(o: NettingOrder): string {
  return o.kind === "plan"
    ? `S&OP PLAN ${o.month} · ${o.item_no} · ${formatUnits(o.quantity)} units planned`
    : `SO ${o.so_number} · ${o.customer_name || "unknown customer"} · ${o.item_no}${o.model ? ` (${o.model})` : ""}`;
}

export function SupplyExplorer() {
  const { plan, loading, refresh } = usePlan();
  const today = useTodayStamp();
  const [netting, setNetting] = useState<Netting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Health>>({});
  const [reload, setReload] = useState(0);
  const [fg, setFg] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [withRec, setWithRec] = useState(false);
  const [horizon, setHorizon] = useState("auto");
  const [scale, setScale] = useState<Granularity>("week");
  const [chartFor, setChartFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupplyDetail | null>(null);
  const [modalComp, setModalComp] = useState<SupplyComponent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => {
    getSupplyStatuses().then(setStatuses).catch(() => {});
  }, [reload]);
  useEffect(() => {
    getSupplyNetting().then(setNetting).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [reload]);

  const orders = useMemo(() => netting?.orders ?? [], [netting]);
  const fgList = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) if (!m.has(o.item_no)) m.set(o.item_no, o.description);
    return [...m.entries()].sort();
  }, [orders]);
  const shown = fg ? orders.filter((o) => o.item_no === fg) : orders;
  const selSo = picked && shown.some((o) => o.so_number === picked) ? picked : shown[0]?.so_number;
  const order = shown.find((o) => o.so_number === selSo);
  const projections = netting ? (withRec ? netting.projections_with : netting.projections_without) : {};
  const rows = useMemo(() => (order ? nettingRows(order.bom, order.quantity, projections) : []), [order, projections]);
  const sf = useSortFilter<NettingRow>(rows, {
    item: { get: (r) => `${r.item_no} ${r.description}`, sort: false },
    status: { get: (r) => (r.kind === "sub" ? "manufactured" : r.stockout ? "shortfall" : "sufficient"), sort: false },
  });
  const fgNo = order?.item_no ?? "";

  useEffect(() => {
    setDetail(null);
    setModalComp(null);
    setChartFor(null);
    if (!fgNo) return;
    let live = true;
    getSupplyDetail(fgNo).then((d) => live && setDetail(d)).catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [fgNo, reload]);

  async function createPo(item: string) {
    setBusy(item);
    setFallback(null);
    try {
      const d = detail ?? (await getSupplyDetail(fgNo));
      const c = d.components.find((x) => x.item_no === item && !x.is_subassembly);
      if (c) setModalComp(c);
      else setFallback(item);
    } catch {
      setFallback(item);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !plan) return <div className="loading">Loading supply data…</div>;
  if (!plan) return null;

  const prefix = (item: string | undefined) => (item && statuses[item] ? DOT[statuses[item]] + " " : "");

  return (
    <div>
      <PageHeader
        title="Supply Explorer"
        sub="Material netting per sales order — click the chart icon on any component for its projected balance"
        actions={
          <>
            <label className="sx-label">
              FG
              <select className="select" value={fg} onChange={(e) => { setFg(e.target.value); setPicked(null); }}>
                <option value="">All finished goods</option>
                {fgList.map(([item, desc]) => (
                  <option key={item} value={item}>{`${prefix(item)}${item} — ${desc}`}</option>
                ))}
              </select>
            </label>
            <label className="sx-label">
              Order
              <select className="select" value={selSo ?? ""} onChange={(e) => setPicked(e.target.value)}>
                {shown.map((o) => (
                  <option key={o.so_number} value={o.so_number}>{`${prefix(o.item_no)}${orderLabel(o)}`}</option>
                ))}
              </select>
            </label>
            <HorizonSelect value={horizon} onChange={setHorizon} />
            <button type="button" className={withRec ? "btn btn--primary" : "btn"} onClick={() => setWithRec(!withRec)}>
              {withRec ? "WITH recommended POs" : "WITHOUT recommended POs"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!order}
              onClick={() => downloadCsv(`supply-netting-${selSo ?? "none"}-${today}.csv`, supplyCsv(selSo ?? "", rows))}
            >
              Export CSV
            </button>
          </>
        }
      />
      {error && <div className="notice notice--bad" role="alert">{error}</div>}
      {netting && orders.length === 0 && <div className="notice">No sales orders with a bill of materials.</div>}

      {order && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__body sx-head" style={{ marginBottom: 0 }}>
            <span className="sx-chip">{order.item_no}</span>
            <div>
              <div className="sx-title">{order.description}</div>
              <div className="sx-sub">
                SO <b className="mono">{order.so_number}</b> · {order.customer_name || "unknown customer"} · {formatUnits(order.quantity)} units
                {order.delivery_date && <> · due {formatShortDate(order.delivery_date)}</>}
              </div>
            </div>
            {order.prod_order_no ? <span className="pill pill--blue">Prod Order {order.prod_order_no}</span> : <span className="pill pill--red">no production order linked</span>}
            {order.series && <span className="pill sx-pill-navy">{order.series}-series</span>}
            {order.model && <span className="pill sx-pill-navy">model {order.model}</span>}
          </div>
        </section>
      )}

      {rows.length > 0 && order && (
        <Card
          title={`Material netting for SO ${selSo} (BOM order)`}
          bodyClassName="sx-wide"
          actions={
            <div className="toolbar" style={{ margin: 0 }}>
              <span className="sx-sub">Chart scale:</span>
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} type="button" className={scale === g ? "btn btn--primary" : "btn"} onClick={() => setScale(g)}>
                  {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
          }
        >
          {fallback && (
            <div className="notice notice--warn" role="status">
              {fallback} is not a purchasable component of {fgNo}. <Link href={`/replenishment?fg=${encodeURIComponent(fgNo)}&item=${encodeURIComponent(fallback)}`}>Open in Replenishment</Link>
            </div>
          )}
          <table className="dt">
            <thead>
              <tr>
                <SfTh sf={sf} id="item" label="Component" />
                <th className="num">Required</th>
                <th className="num">Opening Inv</th>
                <th className="num">Min Balance</th>
                <th className="num">Net Available</th>
                <th>First Stockout</th>
                <SfTh sf={sf} id="status" label="Status" />
                <th>Chart</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sf.view.map((r, i) =>
                r.kind === "sub" ? (
                  <tr key={`${r.item_no}-${i}`} className="sx-sub-row">
                    <td className="mono strong">
                      <span style={{ paddingLeft: (r.level - 1) * 18 }}>
                        ▸ {r.item_no} <span className="sx-sub">{r.description}</span> <span className="pill sx-pill-navy">Sub-assembly · manufactured</span>
                      </span>
                    </td>
                    <td className="num mono">{formatUnits(r.required)}</td>
                    <td colSpan={7} className="muted"><i>produced in-house — components below</i></td>
                  </tr>
                ) : (
                  <Fragment key={`${r.item_no}-${i}`}>
                    <tr className={r.stockout ? "row--red" : ""}>
                      <td>
                        <span style={{ paddingLeft: (r.level - 1) * 18 }}>
                          <b className="mono">{r.item_no}</b> <span className="sx-sub">{r.description}</span>
                        </span>
                      </td>
                      <td className="num mono">{formatUnits(r.required)}</td>
                      <td className="num mono">{formatUnits(r.opening)}</td>
                      <td className={`num mono strong ${r.minBalance < 0 ? "sx-bad" : "sx-ok"}`}>{formatUnits(r.minBalance)}</td>
                      <td className={`num mono strong ${r.netEnd < 0 ? "sx-bad" : "sx-ok"}`}>{r.netEnd > 0 ? "+" : ""}{formatUnits(r.netEnd)}</td>
                      <td>{r.stockout ? formatShortDate(r.stockout) : "—"}</td>
                      <td><span className={r.stockout ? "pill pill--red" : "pill pill--green"}>{r.stockout ? "Shortfall" : "Sufficient"}</span></td>
                      <td>
                        {projections[r.item_no] ? (
                          <button
                            type="button"
                            className="btn"
                            title={chartFor === r.item_no ? "Hide projected balance chart" : "Show projected balance chart"}
                            aria-label={`Chart ${r.item_no}`}
                            aria-pressed={chartFor === r.item_no}
                            onClick={() => setChartFor(chartFor === r.item_no ? null : r.item_no)}
                          >
                            📈
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        <button type="button" className={r.stockout ? "btn btn--danger" : "btn"} disabled={busy === r.item_no} onClick={() => createPo(r.item_no)}>
                          {busy === r.item_no ? "…" : ""} Create PO
                        </button>{" "}
                        <Link
                          className="btn"
                          aria-label={`Replenishment ${r.item_no}`}
                          title="View this part and FG in the Replenishment center (full demand & supply picture)"
                          href={`/replenishment?fg=${encodeURIComponent(fgNo)}&highlight=${encodeURIComponent(r.item_no)}`}
                        >
                          ↗
                        </Link>
                      </td>
                    </tr>
                    {chartFor === r.item_no && projections[r.item_no] && (
                      <tr className="sx-chartrow">
                        <td colSpan={9}>
                          <ProjectionChart proj={projections[r.item_no]} granularity={scale} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
          <p className="sx-note">
            Charts show the projected balance over time — the dashed red line marks the stockout date. Toggle WITH/WITHOUT to see how recommended POs (green dots) resolve shortfalls.
          </p>
        </Card>
      )}

      {modalComp && detail && (
        <CreatePoModal
          comp={modalComp}
          fg={detail.fg_item_no}
          horizon={horizon}
          onClose={() => setModalComp(null)}
          onCreated={() => {
            setModalComp(null);
            void refresh();
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
