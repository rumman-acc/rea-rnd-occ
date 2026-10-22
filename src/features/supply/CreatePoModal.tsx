"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { getBuyRecommendation, pushPurchaseOrder } from "./api";
import { addDays } from "./csv";
import { HORIZONS, type BuyRecommendation, type SupplyComponent } from "./types";
import "./supply.css";

export function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  return (
    <div className="sx-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sx-modal__box" role="dialog" aria-label={title}>
        <div className="sx-modal__head">
          <h3>{title}</h3>
          <button type="button" className="btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sx-modal__body">{children}</div>
        {footer && <div className="sx-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="sx-kv">
    <span className="muted">{label}</span>
    <span>{value}</span>
  </div>
);

/** Create-PO dialog shared by /supply and /replenishment (REQ-SUP-PO-001..005). */
export function CreatePoModal({ comp, fg, horizon, onClose, onCreated }: { comp: SupplyComponent; fg: string; horizon: string; onClose: () => void; onCreated: () => void }) {
  const rt = useRuntime();
  const need = Math.max(-comp.net_available, 0);
  const [rec, setRec] = useState<BuyRecommendation | null>(null);
  const [recFailed, setRecFailed] = useState(false);
  const [qty, setQty] = useState(need);
  const [date, setDate] = useState(addDays(todayIso(rt), comp.lead_time_days ?? 14));
  const [vendor, setVendor] = useState(comp.vendor_no);
  const [cost, setCost] = useState(comp.last_direct_cost || comp.unit_cost);
  const [approved, setApproved] = useState(false);
  const [phase, setPhase] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ po?: string; vendor: string; amount?: number; delivery?: string } | null>(null);

  useEffect(() => {
    let live = true;
    setRec(null);
    setRecFailed(false);
    getBuyRecommendation(comp.item_no, horizon)
      .then((r) => {
        if (!live) return;
        setRec(r);
        setQty(r.recommended_qty || need);
        setDate(r.eta);
        if (r.unit_cost) setCost(r.unit_cost);
      })
      .catch(() => live && setRecFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.item_no, horizon]);

  async function submit() {
    setPhase("pushing");
    try {
      const r = await pushPurchaseOrder(vendor, [{ item_no: comp.item_no, quantity: qty, required_date: date, unit_price: cost || undefined }]);
      setResult({ po: r.bc_po_number, vendor: r.vendor_name || vendor, amount: r.amount, delivery: r.delivery_date });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const canSubmit = approved && qty > 0 && !!vendor && vendor !== "UNASSIGNED" && phase !== "pushing";
  const horizonLabel = rec ? (HORIZONS.find((h) => h.value === rec.horizon)?.label ?? rec.horizon) : "";

  return (
    <Modal
      title={`Create Purchase Order — ${comp.item_no}`}
      onClose={onClose}
      footer={
        phase === "done" ? (
          <button type="button" className="btn btn--primary" onClick={onCreated}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
              {phase === "pushing" ? "Creating draft…" : "Submit Purchase Order"}
            </button>
          </>
        )
      }
    >
      {result && (
        <div className="sx-panel sx-panel--ok" role="status">
          <strong className="sx-ok">Purchase Order created successfully</strong>
          <Row label="PO Number" value={<b className="mono">{result.po}</b>} />
          <Row label="Vendor" value={result.vendor} />
          <Row label="Amount (excl. tax)" value={<b>{formatMoney(result.amount ?? qty * cost)}</b>} />
          <Row label="Delivery Date" value={<b>{formatShortDate(result.delivery)}</b>} />
          <p className="sx-sub">Created as an unreleased draft in the local simulated connector. No external system was contacted.</p>
        </div>
      )}
      <div className="sx-panel sx-panel--ai">
        <div className="sx-sub">
          <strong>BUYER RECOMMENDATION</strong> {rec && <span className="pill pill--purple">{rec.expedite ? "EXPEDITE" : horizonLabel}</span>}
        </div>
        {rec ? <p>{rec.rationale}</p> : recFailed ? <p className="muted">Recommendation service unavailable — fields below are pre-filled from the item card only.</p> : <p className="muted">Computing recommendation…</p>}
      </div>
      <div className="sx-panel">
        <div className="sx-sub">ORDER SUMMARY</div>
        <Row label="Component" value={<b>{comp.description || comp.item_no}</b>} />
        <Row label="Component #" value={<span className="mono">{comp.item_no}</span>} />
        <Row label="For Finished Good" value={<span className="mono">{fg}</span>} />
        <Row label="Net Requirement" value={<b className={need > 0 ? "sx-bad" : "sx-ok"}>{need > 0 ? `${formatUnits(need)} units` : "covered"}</b>} />
        <Row label="Recommended Qty" value={<b>{rec ? `${formatUnits(rec.recommended_qty)} units` : "…"}</b>} />
        <Row label="Total PO Value" value={<b>{formatMoney(qty * cost)}</b>} />
        <Row
          label="Lead Time"
          value={rec ? `${rec.lead_time_days} days${rec.vendor_delay_days > 0 ? ` (+${rec.vendor_delay_days}d vendor slip → plan ${rec.effective_lead_days}d)` : ""}` : `${comp.lead_time_days ?? "—"} days`}
        />
        {rec?.reliability_pct != null && <Row label="Vendor On-Time (12m)" value={`${rec.reliability_pct}%`} />}
        {rec && rec.recommended_qty > 0 && <Row label="Order By" value={<b className={rec.expedite ? "sx-bad" : ""}>{formatShortDate(rec.order_by)}{rec.expedite ? " — passed" : ""}</b>} />}
        <Row label="Suggested ETA" value={<b>{rec ? formatShortDate(rec.eta) : "…"}</b>} />
      </div>
      <div className="sx-form">
        <label className="field">
          {`Order Quantity (MOQ ${formatUnits(comp.minimum_order_qty)}${comp.order_multiple ? ` · multiple ${formatUnits(comp.order_multiple)}` : ""})`}
          <input className="input" type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </label>
        <label className="field">
          Delivery Date
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Vendor No
          <input className="input mono" type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          <span className="muted">{comp.vendor_name || (comp.vendor_no ? "" : "⚠ no default vendor on the item card")}</span>
        </label>
        <label className="field">
          Unit Cost (item card last direct cost)
          <input className="input mono" type="number" min={0} step={0.01} value={cost} onChange={(e) => setCost(Number(e.target.value))} />
        </label>
      </div>
      {phase === "error" && <p className="sx-bad" role="alert">{error}</p>}
      <label className="sx-approve">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        <span>
          I approve creating this as an <b>unreleased draft purchase order</b> in the local simulated connector (demo: no external system is contacted).
        </span>
      </label>
    </Modal>
  );
}
