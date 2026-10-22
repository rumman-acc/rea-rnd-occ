"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { formatUnits } from "@/domain/format";
import { whApi, type Bin, type MovementResult, type StockRow } from "./api";
import { errText } from "./shared";

export function Moves() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [last, setLast] = useState<MovementResult | null>(null);
  useEffect(() => {
    whApi.bins().then(setBins).catch(() => {});
  }, []);
  return (
    <div className="stack">
      {last && (
        <div className={`notice ${last.status === "failed" ? "notice--bad" : ""}`} role="status">
          {last.status === "failed" ? (
            <>
              <b>{last.type} failed</b> — {last.error}
            </>
          ) : (
            <>
              <b>
                {last.type} {last.status}
              </b>{" "}
              — {last.item_no} · {formatUnits(last.qty ?? 0)}
              {last.type === "move" ? ` · ${last.from_bin} → ${last.to_bin}` : last.bin_code ? ` · bin ${last.bin_code}` : ""}
              {last.lot_no ? ` · lot ${last.lot_no}` : ""}
            </>
          )}
        </div>
      )}
      <div className="grid-2">
        <MoveForm kind="move" bins={bins} onDone={setLast} />
        <MoveForm kind="adjust" bins={bins} onDone={setLast} />
      </div>
    </div>
  );
}

const EMPTY = { item_no: "", qty: 0, lot_no: "", from_bin: "", to_bin: "", bin_code: "", reason: "" };

function MoveForm({ kind, bins, onDone }: { kind: "move" | "adjust"; bins: Bin[]; onDone: (r: MovementResult) => void }) {
  const [f, setF] = useState(EMPTY);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toZone, setToZone] = useState("");
  const label = kind === "move" ? "Movement" : "Adjustment";

  useEffect(() => {
    const item = f.item_no.trim();
    setStock(null);
    if (!item) return setLoading(false);
    setLoading(true);
    const t = setTimeout(() => {
      whApi.itemStock(item).then(setStock).catch(() => setStock([])).finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [f.item_no]);

  const perBin: { bin: string; zone: string; qty: number }[] = [];
  for (const r of stock ?? []) {
    const x = perBin.find((p) => p.bin === r.bin);
    if (x) x.qty += r.qty;
    else perBin.push({ bin: r.bin, zone: r.zone, qty: r.qty });
  }
  perBin.sort((a, b) => a.bin.localeCompare(b.bin));
  const bin = kind === "move" ? f.from_bin : f.bin_code;
  const lots = (stock ?? []).filter((r) => r.bin === bin && r.lot);
  const avail = bin ? (f.lot_no ? (lots.find((r) => r.lot === f.lot_no)?.qty ?? 0) : (perBin.find((p) => p.bin === bin)?.qty ?? 0)) : 0;
  const zones = Array.from(new Set(bins.map((b) => b.zone).filter(Boolean))).sort();

  const submit = async () => {
    setError("");
    if (!f.item_no || !f.qty) return setError("Item number and quantity are required.");
    if (kind === "move" && (!f.from_bin || !f.to_bin)) return setError("Both bins are required for a movement.");
    if (kind === "adjust" && !f.bin_code) return setError("A bin is required.");
    if (lots.length > 0 && !f.lot_no) return setError("This item is lot-tracked in that bin — pick the lot.");
    if ((kind === "move" ? f.qty : Math.max(0, -f.qty)) > avail) return setError(`Only ${avail} available in ${bin}${f.lot_no ? ` under lot ${f.lot_no}` : ""}.`);
    setBusy(true);
    try {
      onDone(await whApi.postMovement({ kind, ...f, qty: Number(f.qty) }));
      setF(EMPTY);
      setToZone("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const binSelect = (value: string, onChange: (v: string) => void, name: string) => (
    <select className="select" aria-label={name} value={value} disabled={!f.item_no.trim() || loading || perBin.length === 0} onChange={(e) => onChange(e.target.value)}>
      <option value="">{f.item_no.trim() ? (loading ? "loading…" : perBin.length === 0 ? "no stock at this location" : "— select bin —") : "item first"}</option>
      {perBin.map((p) => (
        <option key={p.bin} value={p.bin}>
          {p.zone} / {p.bin} — {formatUnits(p.qty)}
        </option>
      ))}
    </select>
  );

  return (
    <Card title={kind === "move" ? "Bin-to-Bin Movement (incl. lot)" : "Inventory Quantity Adjustment"}>
      <div className="wh-form">
        <label className="field">
          Item No.
          <input className="input" value={f.item_no} onChange={(e) => setF({ ...f, item_no: e.target.value.toUpperCase(), from_bin: "", bin_code: "", lot_no: "" })} />
        </label>
        <label className="field">
          {kind === "adjust" ? "Qty (+ add / − remove)" : "Quantity"}
          <input type="number" className="input" value={f.qty || ""} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} />
          {bin && (
            <span className="wh-help mono">
              {formatUnits(avail)} available{f.lot_no ? ` · lot ${f.lot_no}` : ""}
            </span>
          )}
        </label>
        {kind === "move" ? (
          <>
            <label className="field">
              From Bin (stock on hand)
              {binSelect(f.from_bin, (v) => setF({ ...f, from_bin: v, lot_no: "" }), "From bin")}
            </label>
            <label className="field">
              To Zone / Bin
              <div className="wh-pair">
                <select className="select" aria-label="To zone" value={toZone} onChange={(e) => { setToZone(e.target.value); setF({ ...f, to_bin: "" }); }}>
                  <option value="">— zone —</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <select className="select" aria-label="To bin" value={f.to_bin} disabled={!toZone} onChange={(e) => setF({ ...f, to_bin: e.target.value })}>
                  <option value="">{toZone ? "— bin —" : "zone first"}</option>
                  {bins.filter((b) => b.zone === toZone).map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Bin (stock on hand)
              {binSelect(f.bin_code, (v) => setF({ ...f, bin_code: v, lot_no: "" }), "Bin")}
            </label>
            <label className="field">
              Reason
              <input className="input" value={f.reason} placeholder="cycle count, damage…" onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </label>
          </>
        )}
        <label className="field">
          Lot No.
          <select className="select" aria-label={`Lot ${label}`} value={f.lot_no} disabled={!bin || lots.length === 0} onChange={(e) => setF({ ...f, lot_no: e.target.value })}>
            <option value="">{bin ? (lots.length === 0 ? "not lot-tracked" : "— select lot —") : "bin first"}</option>
            {lots.map((r) => (
              <option key={r.lot} value={r.lot}>
                {r.lot} — {formatUnits(r.qty)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>
            Post {label}
          </button>
        </div>
      </div>
      {error && (
        <p className="notice notice--bad" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </Card>
  );
}
