"use client";

import { Fragment, useState } from "react";
import { Card } from "@/components/Card";
import type { PricingConfig } from "./config";
import { partyName, partyNo, type ApplyResult, type Batch, type LineRow, type RecheckResult, type ReplacePreview } from "./types";
import { errText, fmtPct, fmtPrice, FlagList, Modal, Pill, Th, useOperator, useTable } from "./ui";

/** Review panel for a staged batch: per-row checks, approve/exclude, re-check, apply. */
export function Review({
  config, batch, onChanged, onApplied, onDone,
}: {
  config: PricingConfig;
  batch: Batch;
  onChanged: (id: string) => Promise<void>;
  onApplied: (kind: "standard" | "party") => void;
  onDone: () => void;
}) {
  const op = useOperator();
  const k = config.party;
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [recheck, setRecheck] = useState<RecheckResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const rows = batch.line_rows;
  const approved = rows.filter((l) => l.decision === "approved" && l.status === "staged");
  const clean = rows.filter((l) => l.decision === "pending" && l.status === "staged" && l.ai.flags.length === 0);
  const flags = batch.summary.flags;
  const blocking = flags.filter((f) => f.level === "red" && f.code !== "duplicate_file");
  const dupFile = flags.filter((f) => f.code === "duplicate_file");

  const t = useTable<LineRow>(rows, {
    row: { get: (l) => l.row_no, numeric: true },
    item: { get: (l) => `${l.payload.item_no} ${l.payload.item_description ?? ""}` },
    party: { get: (l) => `${partyNo(l.payload, k)} ${partyName(l.payload, k)}` },
    qty: { get: (l) => l.payload.min_qty, numeric: true },
    price: { get: (l) => l.payload.price, numeric: true },
    current: { get: (l) => l.ai.current_price ?? 0, numeric: true },
    margin: { get: (l) => l.ai.margin_pct ?? 0, numeric: true },
    target: { get: (l) => l.payload.target },
    replace: { get: (l) => (l.payload.replace_existing === true ? "replace" : l.payload.replace_existing === false ? "keep" : "default") },
    checks: { get: (l) => l.ai.flags.length, numeric: true },
    status: { get: (l) => `${l.decision} ${l.status}` },
  });

  async function patch(l: LineRow, body: { decision?: LineRow["decision"]; payload?: Record<string, unknown> }) {
    setErr("");
    try {
      await config.api.patchLine(l.id, { operator: op, ...body });
      await onChanged(batch.id);
    } catch (e) {
      setErr(errText(e));
    }
  }

  const marginTone = (m: number | null) =>
    m == null ? "pw-dim" : config.lowMarginIsBad ? (m < 0 ? "pw-down" : m < 15 ? "" : "pw-up") : m < 0 ? "" : "pw-up";

  return (
    <Card
      title={`Review: ${batch.label}`}
      bodyClassName="pw-flush"
      actions={
        <div className="toolbar" style={{ margin: 0 }}>
          <span className="pw-small">
            {rows.length} row(s) · {batch.summary.items} item(s) · {config.reviewNote(batch.summary.targets.bc_item_card)}
          </span>
          <button
            className="btn"
            disabled={busy}
            title="Re-run every check on the unapplied rows against current data and settings."
            onClick={async () => {
              setBusy(true);
              try {
                setRecheck(await config.api.recheck(batch.id, op));
                await onChanged(batch.id);
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Re-check rows
          </button>
          {clean.length > 0 && (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  for (const l of clean) await config.api.patchLine(l.id, { operator: op, decision: "approved" });
                  await onChanged(batch.id);
                } catch (e) {
                  setErr(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Approve {clean.length} clean
            </button>
          )}
          <button className="btn btn--green" disabled={approved.length === 0 || blocking.length > 0} onClick={() => setApplyOpen(true)}>
            Apply {approved.length} price(s)
          </button>
          <button className="btn" onClick={onDone}>
            Close
          </button>
        </div>
      }
    >
      {flags.length > 0 && (
        <div className="pw-strip">
          <FlagList flags={flags} />
          {dupFile.length > 0 && blocking.length === 0 && (
            <div className="pw-small">This warning is about the file, not any price. Apply is still allowed; every row is still checked individually.</div>
          )}
        </div>
      )}
      {err && <div className="pw-strip pw-strip--bad">{err}</div>}
      {recheck && (
        <div className={`pw-strip ${recheck.lines_changed ? "pw-strip--warn" : "pw-strip--ok"}`}>
          <b>
            Re-checked {recheck.lines_rechecked} row(s) against current data: {recheck.lines_changed ? `${recheck.lines_changed} changed verdict.` : "no verdict changed."}
          </b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {recheck.changes.slice(0, 8).map((c) => (
              <li key={c.row_no}>
                row {c.row_no} · {c.subject}: {c.flags_after.length ? `now ${c.flags_after.join(", ")}` : "now clean"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {applied && (
        <div className={`pw-strip ${applied.failed ? "pw-strip--bad" : "pw-strip--ok"}`}>
          <b>
            {applied.applied} price(s) applied, {applied.failed} failed
            {applied.protected ? `, ${applied.protected} skipped (governed price protected)` : ""}
            {applied.bc_item_cards_updated ? `, ${applied.bc_item_cards_updated} written to the BC item card (simulated)` : ""}.
          </b>{" "}
          {applied.protected > 0 && <span className="pw-small">Skipped rows stay staged; re-apply with protection off to overwrite deliberately.</span>}
          {applied.confirmation && <span className="pw-small"> Confirmation record saved: see the History tab.</span>}
        </div>
      )}
      <div className="table-scroll">
        <table className="dt pw-dt pw-nowrap">
          <thead>
            <tr>
              <th />
              <Th t={t} id="row" label="#" />
              <Th t={t} id="item" label="Item" />
              <Th t={t} id="party" label={config.partyLabel} />
              <Th t={t} id="qty" label="Min qty" />
              <Th t={t} id="price" label="New price" />
              <Th t={t} id="current" label="Current" />
              <Th t={t} id="margin" label={config.marginLabel} />
              <Th t={t} id="target" label="Target" />
              <Th t={t} id="replace" label="Replace" />
              <Th t={t} id="checks" label="Checks" />
              <Th t={t} id="status" label="Decision" />
            </tr>
          </thead>
          <tbody>
            {t.view.map((l) => {
              const red = l.ai.flags.some((f) => f.level === "red");
              const staged = l.status === "staged";
              return (
                <Fragment key={l.id}>
                  <tr style={l.decision === "excluded" ? { opacity: 0.45 } : undefined}>
                    <td>
                      <button className="pw-link" aria-label={`Details for row ${l.row_no}`} onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                        {expanded === l.id ? "−" : "+"}
                      </button>
                    </td>
                    <td className="pw-dim">{l.row_no}</td>
                    <td>
                      <span className="pw-mono strong">{l.payload.item_no}</span>
                      <div className="pw-small">{l.payload.item_description}</div>
                    </td>
                    <td>
                      {partyNo(l.payload, k) === "ALL" ? (
                        <Pill tone="navy">All {config.partyPlural}</Pill>
                      ) : (
                        <>
                          <span className="pw-mono">{partyNo(l.payload, k)}</span>
                          <div className="pw-small">{partyName(l.payload, k)}</div>
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        type="number" className="pw-num-in" aria-label={`Min qty row ${l.row_no}`} defaultValue={l.payload.min_qty} disabled={!staged}
                        onBlur={(e) => Number(e.target.value) !== l.payload.min_qty && patch(l, { payload: { min_qty: Number(e.target.value) } })}
                      />
                    </td>
                    <td>
                      <input
                        type="number" step="0.01" className="pw-num-in pw-mono" aria-label={`New price row ${l.row_no}`} defaultValue={l.payload.price} disabled={!staged}
                        onBlur={(e) => Number(e.target.value) !== l.payload.price && patch(l, { payload: { price: Number(e.target.value) } })}
                      />
                    </td>
                    <td className="num pw-mono">
                      {fmtPrice(l.ai.current_price)}
                      {l.ai.delta_pct != null && <span className={l.ai.delta_pct < 0 ? "pw-down" : "pw-up"}> {fmtPct(l.ai.delta_pct)}</span>}
                    </td>
                    <td className={`num pw-mono ${marginTone(l.ai.margin_pct)}`}>{l.ai.margin_pct == null ? "—" : `${l.ai.margin_pct.toFixed(1)}%`}</td>
                    <td>
                      <Pill tone={l.payload.target === "bc_item_card" ? "blue" : "gray"}>{l.payload.target === "bc_item_card" ? "BC item card" : "price book"}</Pill>
                    </td>
                    <td>
                      <select
                        className="select" aria-label={`Replace row ${l.row_no}`} disabled={!staged}
                        value={l.payload.replace_existing === true ? "yes" : l.payload.replace_existing === false ? "no" : ""}
                        title="Supersede this item's existing prices before writing this one. Blank follows the choice made when you press Apply."
                        onChange={(e) => patch(l, { payload: { replace_existing: e.target.value === "yes" ? true : e.target.value === "no" ? false : null } })}
                      >
                        <option value="">default</option>
                        <option value="yes">replace</option>
                        <option value="no">keep</option>
                      </select>
                    </td>
                    <td>{l.ai.flags.length === 0 ? <Pill tone="green">clean</Pill> : <Pill tone={red ? "red" : "yellow"}>{l.ai.flags.length} check(s)</Pill>}</td>
                    <td>
                      {l.status === "applied" ? (
                        <Pill tone="green">{String(l.result.outcome ?? "applied")}</Pill>
                      ) : l.status === "failed" ? (
                        <Pill tone="red">{String(l.result.error ?? "failed").slice(0, 48)}</Pill>
                      ) : (
                        <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                          <button
                            className={`pw-mini ${l.decision === "approved" ? "is-ok" : ""}`} disabled={red} title={red ? "Fix the red check first" : "Approve this price"}
                            aria-label={`Approve row ${l.row_no}`} onClick={() => patch(l, { decision: l.decision === "approved" ? "pending" : "approved" })}
                          >
                            Approve
                          </button>
                          <button className={`pw-mini ${l.decision === "excluded" ? "is-bad" : ""}`} aria-label={`Exclude row ${l.row_no}`} onClick={() => patch(l, { decision: l.decision === "excluded" ? "pending" : "excluded" })}>
                            Exclude
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr>
                      <td colSpan={12} style={{ background: "var(--surface2)" }}>
                        <div className="grid-2">
                          <div>
                            <div className="pw-small strong">VALIDATION CHECKS</div>
                            <FlagList flags={l.ai.flags} />
                          </div>
                          <div className="pw-small">
                            <div><b>Applicable price today:</b> {fmtPrice(l.ai.applicable_price)}</div>
                            <div><b>Exact entry now:</b> {fmtPrice(l.ai.current_price)}</div>
                            <div><b>{config.costLabel}:</b> {fmtPrice(l.ai.unit_cost)}</div>
                            <div><b>Currency / UoM:</b> {l.payload.currency} · {l.payload.uom ?? "—"}</div>
                            {l.payload.effective_from && <div><b>Effective from:</b> {l.payload.effective_from}</div>}
                            {l.status !== "staged" && <div><b>Result:</b> {JSON.stringify(l.result)}</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {applyOpen && (
        <ApplyDialog
          config={config} batch={batch} approved={approved.length}
          cards={approved.filter((l) => l.payload.target === "bc_item_card").length}
          rowOptIns={approved.filter((l) => l.payload.replace_existing === true).length}
          onClose={() => setApplyOpen(false)}
          onDone={async (r) => {
            setApplyOpen(false);
            setApplied(r);
            onApplied(r.results.some((x) => x.status === "applied" && partyNo(x, k) && partyNo(x, k) !== "ALL") ? "party" : "standard");
            await onChanged(batch.id);
          }}
        />
      )}
    </Card>
  );
}

function ApplyDialog({
  config, batch, approved, cards, rowOptIns, onClose, onDone,
}: {
  config: PricingConfig;
  batch: Batch;
  approved: number;
  cards: number;
  rowOptIns: number;
  onClose: () => void;
  onDone: (r: ApplyResult) => Promise<void>;
}) {
  const op = useOperator();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pushBc, setPushBc] = useState(true);
  const [protect, setProtect] = useState(true);
  const [existing, setExisting] = useState<"retire" | "delete" | "leave">("retire");
  const [scope, setScope] = useState("price");
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const replace = existing !== "leave";
  const mode = existing === "delete" ? "delete" : "retire";
  const needPreview = mode === "delete" && replace && !preview;
  const N = config.supersedeNoun;
  const pn = config.partyPlural;

  const choose = (v: typeof existing) => {
    setExisting(v);
    setPreview(null);
  };
  const scopes: [string, string, string][] = [
    ["price", `Only the ${config.amountNoun} it replaces (recommended)`, `Same ${config.party}, same quantity break, same currency and unit of measure. Breaks not in this file keep their ${N}.`],
    [config.party === "customer" ? "item_customer" : "item_vendor", `This item for this ${config.party}, every quantity break`, `Also ends the breaks for that ${config.party} that are nowhere in this file.`],
    ["item_all", `This item for EVERY ${config.party}`, `Also ends ${N} for ${pn} who are nowhere in this file, plus the all-${pn} ${config.amountNoun}.`],
  ];

  return (
    <Modal
      title="Apply price updates"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          {replace && !preview && (
            <button
              className="btn" disabled={checking || busy}
              onClick={async () => {
                setChecking(true);
                setErr("");
                try {
                  setPreview(await config.api.replacePreview(batch.id, op, { replace_existing: replace, replace_scope: scope, replace_mode: mode }));
                } catch (e) {
                  setErr(errText(e));
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? "Checking…" : mode === "retire" ? "Show what will be retired" : "Show what will be deleted"}
            </button>
          )}
          <button
            className={replace && mode === "delete" ? "btn btn--danger" : "btn btn--green"}
            disabled={busy || approved === 0 || needPreview}
            title={needPreview ? "A permanent delete has to be previewed first" : undefined}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onDone(await config.api.execute(batch.id, op, { push_to_bc: config.itemCardPush && pushBc, replace_existing: replace, replace_scope: scope, protect_governed: protect, replace_mode: mode }));
              } catch (e) {
                setErr(errText(e));
                setBusy(false);
              }
            }}
          >
            {busy ? "Applying…" : replace ? (mode === "retire" ? `Retire & apply ${N}` : `Delete & apply ${N}`) : `Apply ${N}`}
          </button>
        </>
      }
    >
      <p>
        <b>{approved}</b> approved {config.amountNoun}(s) become the current {N}
        {existing === "retire" && <> — each one that replaces an existing {config.amountNoun} ends it <b>the day before the new one starts</b> and keeps it as history.</>}
        {existing === "delete" && <> — the {N} they replace are <b className="pw-down">deleted permanently</b>, leaving no history.</>}
        {existing === "leave" && <> — the existing {N} stay exactly as they are, with the new ones layered beside them.</>}
      </p>
      {config.itemCardPush && cards > 0 && (
        <label className="pw-box" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={pushBc} onChange={(e) => setPushBc(e.target.checked)} />
          <span>
            Also update the <b>Unit Price on {cards} BC item card(s)</b> (simulated connector). These are base standard prices (all {pn}, no quantity break). {config.partyLabel}-specific prices and quantity breaks stay in the app.
          </span>
        </label>
      )}
      {!config.itemCardPush && cards > 0 && <p className="pw-small">The BC item card is never updated from purchase prices.</p>}
      <div className="pw-box">
        <p className="pw-small strong">THE {N.toUpperCase()} THESE ROWS SUPERSEDE</p>
        {([
          ["retire", "Give them an ending date (recommended)", `The superseded ${config.amountNoun} stays as history, ended the day before the new one starts.`],
          ["delete", "Delete them permanently", "Removes the records outright, leaving no history."],
          ["leave", "Leave them in place", `The new ${config.amountNoun} is layered beside the existing records.`],
        ] as const).map(([v, title, text]) => (
          <label key={v} className="pw-radio">
            <input type="radio" name="existing-prices" checked={existing === v} onChange={() => choose(v)} />
            <span>
              <b className={v === "delete" ? "pw-down" : ""}>{title}</b>
              <small>{text}</small>
            </span>
          </label>
        ))}
        {replace && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <p className="pw-small strong">HOW MUCH EACH ROW {mode === "retire" ? "RETIRES" : "DELETES"}</p>
            {scopes.map(([v, title, text]) => (
              <label key={v} className="pw-radio">
                <input type="radio" name="replace-scope" checked={scope === v} onChange={() => { setScope(v); setPreview(null); }} />
                <span>
                  <b className={v === "item_all" ? "pw-down" : ""}>{title}</b>
                  <small>{text}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {!replace && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <label className="pw-radio">
              <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
              <span>
                <b>Protect governed {N}</b> — a row that would <i>change</i> a {config.amountNoun} this app already governs is skipped rather than overwriting it silently (it stays staged).
              </span>
            </label>
            {rowOptIns > 0 && <p className="pw-small">{rowOptIns} row(s) are set to replace individually, so those still supersede their existing {config.amountNoun}.</p>}
          </div>
        )}
      </div>
      {preview && (
        <div className={`pw-box ${preview.book_total + preview.bc_total > 0 && mode === "delete" ? "pw-box--bad" : ""}`}>
          <p className="strong">
            {preview.book_total + preview.bc_total === 0
              ? `Nothing existing to supersede — these ${N} are all new.`
              : mode === "retire"
                ? `${preview.bc_total} price line(s) in Business Central (simulated) get an ending date and stay as history, ${preview.book_total} ${config.amountNoun}(s) leave the app's book, then the new ${N} are written.`
                : `${preview.book_total} ${config.amountNoun}(s) in the app's book and ${preview.bc_total} line(s) in Business Central (simulated) are DELETED permanently, then the new ${N} are written.`}
          </p>
          <p className="pw-small">Reach: {preview.scope_label}.</p>
          {preview.rows.length > 0 && (
            <ul style={{ maxHeight: 190, overflowY: "auto", paddingLeft: 18, margin: "6px 0" }}>
              {preview.rows.map((r) => (
                <li key={r.row_no} className="pw-small">
                  <b>{r.item_no}</b> · {partyNo(r, config.party)} — {mode === "retire" ? "ending" : "removing"} {r.book_count} book / {r.bc_count} BC:{" "}
                  {r.book.map((b) => fmtPrice(b.price) + (b.min_qty ? ` @qty ${b.min_qty}` : "")).join(", ") || "—"}
                </li>
              ))}
            </ul>
          )}
          <p className="pw-small">{preview.legacy_note}</p>
        </div>
      )}
      <p className="pw-small">Every outcome is journaled and a confirmation record is produced (operator: {op}).</p>
      {err && <p className="pw-down strong">{err}</p>}
    </Modal>
  );
}
