"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { EvidenceNotice } from "@/features/admin/EvidenceNotice";
import { getSettings, putSettings, type AppSettings } from "./api";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Form = Record<keyof AppSettings, string | boolean>;
const toForm = (s: AppSettings): Form => ({ ...s, planningHorizonWeeks: String(s.planningHorizonWeeks), defaultLeadTimeDays: String(s.defaultLeadTimeDays), autoRefreshSeconds: String(s.autoRefreshSeconds) });

export function SettingsPage() {
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then((s) => { setSaved(s); setForm(toForm(s)); }).catch((e) => setError(msg(e)));
  }, []);

  if (!form) {
    return (
      <div className="stack">
        <PageHeader title="Settings" />
        <EvidenceNotice />
        {error ? <div className="notice notice--bad" role="alert">{error}</div> : <div className="empty">Loading settings…</div>}
      </div>
    );
  }

  const set = (k: keyof AppSettings, v: string | boolean) => { setForm({ ...form, [k]: v }); setStatus(""); };
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved!));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("");
    const num = (v: string | boolean) => (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    setBusy(true);
    try {
      const next = await putSettings({
        companyName: form.companyName as string,
        currency: form.currency as AppSettings["currency"],
        timezone: form.timezone as string,
        planningHorizonWeeks: num(form.planningHorizonWeeks),
        defaultLeadTimeDays: num(form.defaultLeadTimeDays),
        autoRefreshSeconds: num(form.autoRefreshSeconds),
        notificationEmail: form.notificationEmail as string,
        showDemoBadge: form.showDemoBadge as boolean,
      });
      setSaved(next);
      setForm(toForm(next));
      setStatus("Settings saved.");
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  const text = (k: keyof AppSettings, label: string, type = "text") => (
    <label className="field">
      {label}
      <input className="input" type={type} value={form[k] as string} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <div className="stack">
      <PageHeader title="Settings" sub="Application settings" />
      <EvidenceNotice />
      <Card title="Application settings">
        <form className="stack" onSubmit={submit} noValidate>
          <div className="grid-2">
            {text("companyName", "Company name")}
            <label className="field">
              Currency
              <select className="select" value={form.currency as string} onChange={(e) => set("currency", e.target.value)}>
                <option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </label>
            {text("timezone", "Time zone")}
            {text("planningHorizonWeeks", "Planning horizon (weeks)", "number")}
            {text("defaultLeadTimeDays", "Default lead time (days)", "number")}
            {text("autoRefreshSeconds", "Auto refresh (seconds, 0 = off)", "number")}
            {text("notificationEmail", "Notification email")}
            <label className="field">
              <span>
                <input type="checkbox" checked={form.showDemoBadge as boolean} onChange={(e) => set("showDemoBadge", e.target.checked)} /> Show demo badge
              </span>
            </label>
          </div>
          {error && <div className="notice notice--bad" role="alert">{error}</div>}
          {status && <div className="notice" role="status">{status}</div>}
          <div className="toolbar">
            <button type="submit" className="btn btn--primary" disabled={busy || !dirty}>Save settings</button>
            <button type="button" className="btn" disabled={busy || !dirty} onClick={() => { setForm(toForm(saved!)); setError(""); }}>Reset</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
