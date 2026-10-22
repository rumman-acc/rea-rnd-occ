"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/Card";
import type { PricingConfig } from "./config";
import type { Batch, BatchHead, LogEntry } from "./types";
import { csvCell, download, errText, fmtPrice, Notice, Pill, Th, useOperator, useTable } from "./ui";

/** Tab "Price History": processed batches (with downloads) and the immutable action log. */
export function PriceHistoryView({ config, header, onResumeReview }: { config: PricingConfig; header: ReactNode; onResumeReview?: (id: string) => void }) {
  const op = useOperator();
  const api = config.api;
  const k = config.party;
  const [batches, setBatches] = useState<BatchHead[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState<Batch | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setBatches(await api.batches(archived));
      setLog(await api.log(300));
    } catch (e) {
      setErr(errText(e));
    }
  }, [api, archived]);
  useEffect(() => {
    void load();
  }, [load]);

  const bt = useTable<BatchHead>(batches, {
    up: { get: (b) => b.uploaded_at },
    label: { get: (b) => `${b.label} ${b.source_file}` },
    op: { get: (b) => b.operator },
    rows: { get: (b) => b.lines, numeric: true },
    applied: { get: (b) => b.applied, numeric: true },
    status: { get: (b) => b.status },
  });
  const detail = (l: LogEntry) => l.detail as Record<string, string | number | undefined>;
  const lt = useTable<LogEntry>(log, {
    ts: { get: (l) => l.ts },
    op: { get: (l) => l.operator },
    action: { get: (l) => config.logActions[l.action] ?? l.action },
    subject: { get: (l) => String(detail(l).subject ?? l.ref) },
    change: { get: (l) => Number(detail(l).price_after ?? 0), numeric: true },
    batch: { get: (l) => String(detail(l).batch_label ?? detail(l).batch_id ?? "") },
    bc: { get: (l) => [detail(l).bc_item_card, detail(l).bc_price_list].filter(Boolean).join(" ") },
    outcome: { get: (l) => l.outcome },
    note: { get: (l) => String(detail(l).error ?? detail(l).note ?? "") },
  });
  const tone = (s: string) => (s === "applied" ? "green" : s === "review" ? "blue" : s === "partial" ? "yellow" : s === "failed" ? "red" : "gray");

  return (
    <>
      {header}
      {err && <Notice tone="bad">{err}</Notice>}
      <Card
        title="Price update batches"
        bodyClassName="pw-flush"
        actions={
          <label className="pw-small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Show archived
          </label>
        }
      >
        <div className="table-scroll">
          <table className="dt pw-dt">
            <thead>
              <tr>
                <Th t={bt} id="up" label="Uploaded" />
                <Th t={bt} id="label" label="Label / file" />
                <Th t={bt} id="op" label="Operator" />
                <Th t={bt} id="rows" label="Rows" right />
                <Th t={bt} id="applied" label="Applied" right />
                <Th t={bt} id="status" label="Status" />
                <th>Files</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bt.view.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 28 }}>No price update batches yet.</td>
                </tr>
              )}
              {bt.view.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{b.uploaded_at.replace("T", " ")}</td>
                  <td className="strong pw-clip" title={b.label}>{b.label}{b.simulated && <> <Pill tone="gray">simulated</Pill></>}</td>
                  <td>{b.operator}</td>
                  <td className="num pw-mono">{b.lines}</td>
                  <td className="num pw-mono">{b.applied}</td>
                  <td><Pill tone={tone(b.status)}>{b.status}</Pill></td>
                  <td className="nowrap">
                    <a className="pw-link" href={api.sourceUrl(b.id)}>original file</a> · <a className="pw-link" href={api.confirmationUrl(b.id)}>confirmation record</a>
                  </td>
                  <td>
                    <div className="toolbar" style={{ margin: 0, gap: 8 }}>
                      <button className="pw-link" onClick={async () => setOpen(open?.id === b.id ? null : await api.batch(b.id))}>
                        {open?.id === b.id ? "hide rows" : "view rows"}
                      </button>
                      {(b.status === "review" || b.status === "partial") && onResumeReview && (
                        <button className="pw-link" title="Open this batch in the review list" onClick={() => onResumeReview(b.id)}>resume review →</button>
                      )}
                      {b.status !== "archived" && (
                        <button className="pw-link" onClick={async () => { await api.archive(b.id, op); if (open?.id === b.id) setOpen(null); await load(); }}>archive</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      {open && (
        <>
          <Card title={`Rows processed: ${open.label}`} bodyClassName="pw-flush">
            <div className="table-scroll">
              <table className="dt">
                <thead>
                  <tr><th>#</th><th>Item</th><th>{config.partyLabel}</th><th>Min qty</th><th>Price</th><th>Previous</th><th>Result</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {open.line_rows.map((l) => {
                    const pn = String((k === "customer" ? l.payload.customer_no : l.payload.vendor_no) ?? "");
                    return (
                      <tr key={l.id}>
                        <td className="pw-dim">{l.row_no}</td>
                        <td className="pw-mono">{l.payload.item_no}</td>
                        <td>{pn === "ALL" ? `All ${config.partyPlural}` : pn}</td>
                        <td className="num pw-mono">{l.payload.min_qty || "any"}</td>
                        <td className="num pw-mono strong">{fmtPrice(l.payload.price)}</td>
                        <td className="num pw-mono pw-dim">{fmtPrice(l.result.prev_price as number | null | undefined)}</td>
                        <td><Pill tone={l.status === "applied" ? "green" : l.status === "failed" ? "red" : "gray"}>{String(l.result.outcome ?? l.status)}</Pill></td>
                        <td className="pw-small pw-clip">{String(l.result.error ?? l.result.bc_item_card ?? "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div style={{ height: 16 }} />
        </>
      )}
      <Card
        title={config.logTitle}
        bodyClassName="pw-flush"
        actions={
          <div className="toolbar" style={{ margin: 0 }}>
            <span className="pw-small">{lt.view.length} of {log.length} entries: one row per price actually changed</span>
            <button
              className="btn"
              onClick={() =>
                download("pricing-action-log.csv", [
                  "When,Operator,Action,Subject,PriceBefore,PriceAfter,Batch,Outcome,Note",
                  ...lt.view.map((l) => [l.ts, csvCell(l.operator), csvCell(config.logActions[l.action] ?? l.action), csvCell(detail(l).subject ?? l.ref), detail(l).price_before ?? "", detail(l).price_after ?? "", csvCell(detail(l).batch_label ?? ""), l.outcome, csvCell(detail(l).error ?? detail(l).note ?? "")].join(",")),
                ])
              }
            >
              Export CSV
            </button>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="dt pw-dt">
            <thead>
              <tr>
                <Th t={lt} id="ts" label="When" />
                <Th t={lt} id="op" label="Who" />
                <Th t={lt} id="action" label="What happened" />
                <Th t={lt} id="subject" label="Price affected" />
                <Th t={lt} id="change" label="Before → After" right />
                <Th t={lt} id="batch" label="Batch" />
                <Th t={lt} id="bc" label="Business Central (simulated)" />
                <Th t={lt} id="outcome" label="Outcome" />
                <Th t={lt} id="note" label="Note" />
              </tr>
            </thead>
            <tbody>
              {lt.view.length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 28 }}>No log entries match.</td></tr>
              )}
              {lt.view.map((l) => {
                const d = detail(l);
                const before = d.price_before as number | undefined;
                const after = d.price_after as number | undefined;
                return (
                  <tr key={l.id}>
                    <td className="pw-mono pw-small nowrap">{l.ts.replace("T", " ").slice(0, 19)}</td>
                    <td>{l.operator}</td>
                    <td className="strong">{config.logActions[l.action] ?? l.action}</td>
                    <td className="pw-clip" title={String(d.subject ?? l.ref)}>{String(d.subject ?? l.ref)}</td>
                    <td className="num pw-mono nowrap">{after != null ? <>{before != null ? `${fmtPrice(before)} → ` : ""}<b>{fmtPrice(after)}</b></> : "—"}</td>
                    <td className="pw-clip pw-small">{String(d.batch_label ?? d.batch_id ?? "—")}</td>
                    <td className="pw-clip pw-small">{[d.bc_item_card, d.bc_price_list].filter(Boolean).join(" · ") || "—"}</td>
                    <td><Pill tone={l.outcome === "ok" ? "green" : "red"}>{l.outcome}</Pill></td>
                    <td className="pw-clip pw-small">{String(d.error ?? d.note ?? "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
