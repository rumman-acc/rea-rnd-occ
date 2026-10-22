"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { whApi, type WhSettings } from "./api";
import { errText, Loading } from "./shared";

export function Settings() {
  const [s, setS] = useState<WhSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    whApi.settings().then(setS).catch((e) => setError(errText(e)));
  }, []);
  if (!s) return error ? <p className="notice notice--bad">{error}</p> : <Loading label="Loading warehouse settings…" />;

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      setS(await whApi.saveSettings(s));
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Warehouse settings">
      <p className="wh-help">Receiving tolerance applies now. Printer, scanner and barcode values are stored only; no hardware integration exists in this demo.</p>
      <div className="wh-settings" style={{ marginTop: 12 }}>
        <label className="field">
          Over-delivery tolerance (%)
          <input type="number" className="input" min={0} max={100} step={0.5} value={s.over_delivery_tolerance_pct} onChange={(e) => setS({ ...s, over_delivery_tolerance_pct: Number(e.target.value) })} />
          <span className="wh-help">A receipt may exceed the ordered line quantity by up to this percentage; the PO line is raised to match. 0 disables over-delivery.</span>
        </label>
        <div />
        <label className="field">
          Label printer
          <input className="input" value={s.printer.label_printer} placeholder="e.g. ZEBRA-WH1 (not wired up)" onChange={(e) => setS({ ...s, printer: { ...s.printer, label_printer: e.target.value } })} />
        </label>
        <label className="field">
          Document printer
          <input className="input" value={s.printer.document_printer} placeholder="(not wired up)" onChange={(e) => setS({ ...s, printer: { ...s.printer, document_printer: e.target.value } })} />
        </label>
        <label className="field">
          Scanner mode
          <select className="select" value={s.scanner.mode} onChange={(e) => setS({ ...s, scanner: { mode: e.target.value } })}>
            <option value="keyboard-wedge">Keyboard wedge</option>
            <option value="serial">Serial</option>
            <option value="camera">Camera (mobile)</option>
          </select>
        </label>
        <label className="field">
          Barcode symbology
          <select className="select" value={s.barcode.symbology} onChange={(e) => setS({ ...s, barcode: { symbology: e.target.value } })}>
            <option value="code128">Code 128</option>
            <option value="code39">Code 39</option>
            <option value="qr">QR</option>
            <option value="datamatrix">Data Matrix</option>
          </select>
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn btn--primary" onClick={save} disabled={busy}>
          Save settings
        </button>
        {saved && <span style={{ color: "var(--ok)", fontWeight: 600, fontSize: 12 }}>Saved.</span>}
        {error && (
          <span className="wh-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </Card>
  );
}
