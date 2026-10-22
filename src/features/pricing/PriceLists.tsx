"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/Card";
import type { PricingConfig } from "./config";
import { Review } from "./Review";
import { partyName, partyNo, type Batch, type EntryInput, type ExternalApp, type Overview, type PartyRef, type PriceList, type PriceRow } from "./types";
import { csvCell, download, errText, fmtInt, fmtPct, fmtPrice, Modal, Notice, Pill, Th, useOperator, useTable } from "./ui";

const SIM = "simulated";

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone: "blue" | "amber" | "green" | "red" }) {
  return (
    <div className={`kpi kpi--${tone}`} data-testid="pricing-kpi">
      <div className="kpi__bar" />
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__sub">{sub}</div>
    </div>
  );
}

/** Tab "Price Lists": book overview, loading prices, review of staged batches, and the price list itself. */
export function PriceListsView({ config, header }: { config: PricingConfig; header: ReactNode }) {
  const op = useOperator();
  const api = config.api;
  const k = config.party;
  const [scope, setScope] = useState<"standard" | "party">("standard");
  const [partyFilter, setPartyFilter] = useState("");
  const [list, setList] = useState<PriceList | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [batch, setBatchState] = useState<Batch | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);

  const setBatch = useCallback(
    (b: Batch | null) => {
      setBatchState(b);
      try {
        if (b) sessionStorage.setItem(config.sessionKey, b.id);
        else sessionStorage.removeItem(config.sessionKey);
      } catch {
        // session storage unavailable: resume-review simply does not persist
      }
    },
    [config.sessionKey],
  );

  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(config.sessionKey);
    } catch {
      id = null;
    }
    if (id) api.batch(id).then(setBatchState).catch(() => setBatch(null));
  }, [api, config.sessionKey, setBatch]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [l, o] = await Promise.all([api.list(scope, scope === "party" && partyFilter ? partyFilter : undefined), api.overview()]);
      setList(l);
      setOv(o);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }, [api, scope, partyFilter]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = list?.rows ?? [];
  const t = useTable<PriceRow>(rows, {
    item: { get: (r) => `${r.item_no} ${r.item_description}` },
    party: { get: (r) => `${partyNo(r, k)} ${partyName(r, k)}` },
    qty: { get: (r) => r.min_qty, numeric: true },
    price: { get: (r) => r.price, numeric: true },
    prev: { get: (r) => r.prev_price ?? 0, numeric: true },
    change: { get: (r) => r.change_pct ?? 0, numeric: true },
    cost: { get: (r) => r.unit_cost ?? 0, numeric: true },
    margin: { get: (r) => r.margin_pct ?? 0, numeric: true },
    updated: { get: (r) => r.updated_at ?? "" },
    src: { get: (r) => `${r.source} ${r.updated_by}` },
  });

  const book = ov?.book ?? {};
  const partyCount = Number(book[`${k}s`] ?? 0);
  const specific = Number(book[`${k}_specific`] ?? 0);
  const parties: PartyRef[] = ((list?.[`${k}s`] as PartyRef[] | undefined) ?? []).filter((p) => !(scope === "party") || !list?.priced || list.priced.includes(p.number));
  const allParties: PartyRef[] = (list?.[`${k}s`] as PartyRef[] | undefined) ?? [];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function readB64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(f);
    });
  }

  const bc = ov?.bc;
  const bcTitle = bc ? (bc.mode === "two-way" ? "two-way sync" : bc.mode === "write-inert" ? "connected, but writes do not price documents" : bc.mode === "read-only" ? "read-only" : "not connected") : "";

  return (
    <>
      {header}
      {err && <Notice tone="bad">{err}</Notice>}
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="pw-grid-4">
        <Kpi label="Price entries" value={fmtInt(Number(book.entries ?? 0))} sub={`${book.standard ?? 0} standard · ${specific} ${config.party}-specific`} tone="blue" />
        <Kpi label="Items priced" value={fmtInt(Number(book.items ?? 0))} sub={`${partyCount} ${config.partyPlural} with own prices`} tone="blue" />
        <Kpi label="Awaiting review" value={ov?.batches_in_review ?? 0} sub={`${ov?.lines_pending ?? 0} price line(s) staged`} tone={(ov?.batches_in_review ?? 0) > 0 ? "amber" : "green"} />
        <Kpi
          label="Open audit findings" value={ov?.open_findings ?? 0}
          sub={ov?.last_audit ? `last audit ${ov.last_audit.ts.slice(0, 10)} · ${ov.last_audit.summary.rating}` : "auditor not run yet"}
          tone={(ov?.open_findings ?? 0) > 0 ? "red" : "green"}
        />
      </div>
      {bc?.warning && <div className="pw-banner pw-banner--warn"><b>{bc.warning}</b></div>}
      {bc && (
        <div className={`pw-banner ${bc.warning ? "pw-banner--warn" : bc.mode === "two-way" ? "pw-banner--ok" : ""}`}>
          <div>
            <b>Business Central price lists ({SIM}): {bcTitle}</b> <span className="pw-small">{bc.detail} No real Business Central connection exists in this app.</span>
          </div>
          <button
            className="btn" disabled={busy || !bc.read}
            onClick={() =>
              run(async () => {
                const r = await api.pullBc(op);
                setMsg(`Pulled ${r.bc_lines} price line(s) from BC (simulated): ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged.`);
                await load();
              })
            }
          >
            Pull prices from BC
          </button>
        </div>
      )}
      <Card
        title="Load prices"
        actions={
          <button className="pw-link" onClick={() => download("price-list-template.csv", config.csvTemplate)}>
            CSV template
          </button>
        }
      >
        <p className="pw-small" style={{ marginBottom: 10 }}>
          One row per <b>{config.itemLabel.toLowerCase()} + {config.party} + quantity break</b>. Leave {config.partyLabel} No blank or put <b>ALL</b> for a price that applies to every {config.party}. Every row is validated against master data, the current price and the item {config.costLabel.toLowerCase()} before anything is applied; the original file and a confirmation record are kept in the History tab. CSV only in this rebuild.
        </p>
        <div className="toolbar" style={{ margin: 0 }}>
          <label className={`btn btn--primary ${busy ? "pw-disabled" : ""}`} style={{ cursor: "pointer" }}>
            {busy ? "Working…" : "Upload price file (CSV)"}
            <input
              type="file" accept=".csv" hidden aria-label="Upload price file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void run(async () => {
                  const b = await api.upload(f.name, await readB64(f), op);
                  setBatch(b);
                  setMsg(`${f.name}: ${b.line_rows.length} row(s) staged for review.`);
                });
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="btn" disabled={busy} title={config.deriveHint}
            onClick={() =>
              run(async () => {
                const b = await api.derive(op, 12);
                setBatch(b);
                setMsg(`Derived ${b.line_rows.length} ${config.deriveDone}: review below, nothing is applied yet.`);
              })
            }
          >
            {config.deriveLabel}
          </button>
          <button className="btn" onClick={() => setExtOpen(true)}>External pricing app ({SIM})</button>
          <button className="btn" onClick={() => setAddOpen(true)}>Add single price</button>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      {batch && (
        <>
          <Review
            config={config} batch={batch}
            onChanged={async (id) => setBatchState(await api.batch(id))}
            onApplied={(kind) => setScope(kind)}
            onDone={() => {
              setBatch(null);
              void load();
            }}
          />
          <div style={{ height: 16 }} />
        </>
      )}
      <Card
        title={scope === "standard" ? "Standard price list" : config.specificListTitle}
        bodyClassName="pw-flush"
        actions={
          <div className="toolbar" style={{ margin: 0 }}>
            <span className="pw-small">
              {t.view.length} of {rows.length} row(s){list?.book.last_updated ? ` · last change ${String(list.book.last_updated).replace("T", " ")}` : ""}
            </span>
            <div className="pw-seg" role="group" aria-label="Price list scope">
              <button className={scope === "standard" ? "is-active" : ""} onClick={() => setScope("standard")}>
                {config.standardTabLabel} {list ? fmtInt(Number(list.book.standard)) : ""}
              </button>
              <button className={scope === "party" ? "is-active" : ""} onClick={() => setScope("party")}>
                {config.specificTabLabel} {list ? fmtInt(Number(list.book[`${k}_specific`] ?? 0)) : ""}
              </button>
            </div>
            {scope === "party" && (
              <select className="select" aria-label={`Filter by ${config.party}`} value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)}>
                <option value="">All {config.partyPlural} with prices</option>
                {parties.map((p) => (
                  <option key={p.number} value={p.number}>
                    {p.name} ({p.number})
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn" disabled={rows.length === 0}
              onClick={() => {
                const head = `Item,Description,${config.partyLabel},${config.partyLabel}Name,MinQty,Price,PrevPrice,Change%,${config.costLabel.replace(/ /g, "")},${config.marginLabel.replace(/ /g, "")}%,Currency,EffectiveFrom,Updated,By,Source`;
                download(`price-list-${scope}.csv`, [
                  head,
                  ...t.view.map((r) => [r.item_no, csvCell(r.item_description), partyNo(r, k), csvCell(partyName(r, k)), r.min_qty, r.price, r.prev_price ?? "", r.change_pct ?? "", r.unit_cost ?? "", r.margin_pct ?? "", r.currency, r.effective_from, r.updated_at ?? "", r.updated_by, csvCell(r.source)].join(",")),
                ]);
              }}
            >
              Export CSV
            </button>
            <button className="btn" onClick={() => void load()}>Refresh</button>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="dt pw-dt pw-nowrap">
            <thead>
              <tr>
                <Th t={t} id="item" label={config.itemLabel} />
                {scope !== "standard" && <Th t={t} id="party" label={config.partyLabel} />}
                <Th t={t} id="qty" label="Min qty" right />
                <Th t={t} id="price" label="Price" right />
                <Th t={t} id="prev" label="Previous" right />
                <Th t={t} id="change" label="Change" right />
                <Th t={t} id="cost" label={config.costLabel} right />
                <Th t={t} id="margin" label={config.marginLabel} right />
                <Th t={t} id="updated" label="Updated" />
                <Th t={t} id="src" label="Source" />
                <th />
              </tr>
            </thead>
            <tbody>
              {t.view.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted" style={{ textAlign: "center", padding: 28 }}>
                    {rows.length === 0 ? config.emptyBook : "No rows match the filters."}
                  </td>
                </tr>
              )}
              {t.view.map((r) => (
                <tr key={`${r.item_no}|${partyNo(r, k)}|${r.min_qty}`}>
                  <td>
                    <span className="pw-mono strong">{r.item_no}</span>
                    <span className="pw-small"> {r.item_description}</span>
                  </td>
                  {scope !== "standard" && (
                    <td>
                      {partyNo(r, k) === "ALL" ? <Pill tone="navy">All {config.partyPlural}</Pill> : <><span className="pw-mono">{partyNo(r, k)}</span> <span className="pw-small">{partyName(r, k)}</span></>}
                    </td>
                  )}
                  <td className="num pw-mono">{r.min_qty ? fmtInt(r.min_qty) : "any"}</td>
                  <td className="num pw-mono strong">{fmtPrice(r.price)}</td>
                  <td className="num pw-mono pw-dim">{fmtPrice(r.prev_price)}</td>
                  <td className={`num pw-mono ${(r.change_pct ?? 0) > 0 ? "pw-up" : (r.change_pct ?? 0) < 0 ? "pw-down" : "pw-dim"}`}>{fmtPct(r.change_pct)}</td>
                  <td className="num pw-mono">{fmtPrice(r.unit_cost)}</td>
                  <td className={`num pw-mono strong ${r.margin_pct == null ? "pw-dim" : r.margin_pct < 0 ? "pw-down" : "pw-up"}`}>{r.margin_pct == null ? "—" : `${r.margin_pct.toFixed(1)}%`}</td>
                  <td className="pw-small">
                    {(r.updated_at ?? "").replace("T", " ").slice(0, 16)}
                    {r.bc_synced_at && <span className="pw-up" title={`Synced to BC (simulated) ${r.bc_synced_at}`}> · BC ✓</span>}
                  </td>
                  <td className="pw-clip pw-small" title={`${r.source}: ${r.updated_by}`}>{r.source}</td>
                  <td>
                    <button
                      className="pw-link" title="Delete this price entry" aria-label={`Delete price ${r.item_no} ${partyNo(r, k)} ${r.min_qty}`}
                      onClick={() => {
                        if (!window.confirm(`Delete the price for ${r.item_no} / ${partyNo(r, k)} / min qty ${r.min_qty}?`)) return;
                        void run(async () => {
                          await api.deleteEntry(r.item_no, partyNo(r, k), r.min_qty, op);
                          await load();
                        });
                      }}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {addOpen && (
        <AddPrice config={config} parties={allParties} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load(); }} />
      )}
      {extOpen && ov && (
        <ExternalApp config={config} settings={ov.settings.external_app} onClose={() => setExtOpen(false)} onSynced={(b) => { setExtOpen(false); setBatch(b); void load(); }} />
      )}
    </>
  );
}

function AddPrice({ config, parties, onClose, onSaved }: { config: PricingConfig; parties: PartyRef[]; onClose: () => void; onSaved: () => void }) {
  const op = useOperator();
  const [f, setF] = useState<EntryInput>({ item_no: "", party_no: "ALL", min_qty: 0, price: 0, currency: "USD", effective_from: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  return (
    <Modal
      title="Add / update a single price"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn--primary" disabled={busy || !f.item_no || !f.price}
            onClick={async () => {
              setBusy(true);
              setErr("");
              setWarn([]);
              try {
                const r = await config.api.upsertEntry(op, f);
                if (r.warnings?.length) setWarn(r.warnings);
                else onSaved();
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save price
          </button>
        </>
      }
    >
      <div className="pw-form">
        <label className="field">
          {config.itemLabel} number
          <input className="input" value={f.item_no} placeholder={`e.g. ${config.exampleItem}`} onChange={(e) => setF({ ...f, item_no: e.target.value })} />
        </label>
        <label className="field">
          {config.partyLabel}
          <select className="select" value={f.party_no} onChange={(e) => setF({ ...f, party_no: e.target.value })}>
            <option value="ALL">ALL: every {config.party} (standard price)</option>
            {parties.map((p) => (
              <option key={p.number} value={p.number}>
                {p.name} ({p.number})
              </option>
            ))}
          </select>
        </label>
        <div className="pw-row2">
          <label className="field">
            Min quantity (break)
            <input className="input" type="number" value={f.min_qty} onChange={(e) => setF({ ...f, min_qty: Number(e.target.value) })} />
          </label>
          <label className="field">
            Price
            <input className="input" type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
          </label>
        </div>
        <div className="pw-row2">
          <label className="field">
            Currency
            <input className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} />
          </label>
          <label className="field">
            Effective from (optional)
            <input className="input" type="date" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} />
          </label>
        </div>
        {warn.length > 0 && (
          <Notice tone="warn">
            <b>Saved with warnings:</b>
            {warn.map((w, i) => <div key={i}>{w}</div>)}
            <button className="btn" style={{ marginTop: 8 }} onClick={onSaved}>Done</button>
          </Notice>
        )}
        {err && <p className="pw-down strong">{err}</p>}
      </div>
    </Modal>
  );
}

function ExternalApp({ config, settings, onClose, onSynced }: { config: PricingConfig; settings: ExternalApp; onClose: () => void; onSynced: (b: Batch) => void }) {
  const op = useOperator();
  const [v, setV] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    await config.api.saveSettings(op, { external_app: v });
  }
  return (
    <Modal
      title="External pricing app"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          <button
            className="btn" disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await save();
                onClose();
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save link
          </button>
          <button
            className="btn btn--primary" disabled={busy || v.mode === "none"}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await save();
                onSynced(await config.api.syncExternal(op));
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Sync now
          </button>
        </>
      }
    >
      <div className="pw-form">
        <Notice tone="warn">Simulated connector: no file is read and no endpoint is called. "Sync now" stages a deterministic demo list (current prices +3% and one new item) as a review batch.</Notice>
        <p className="pw-small">Either way the prices land as a <b>review batch</b>: an external system never writes prices unattended.</p>
        <label className="field">
          Connection
          <select className="select" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as ExternalApp["mode"] })}>
            <option value="none">Not configured</option>
            <option value="file">File / folder export (CSV)</option>
            <option value="api">Direct API sync (JSON endpoint)</option>
          </select>
        </label>
        {v.mode === "file" && (
          <label className="field">
            File or folder path
            <input className="input" value={v.path} onChange={(e) => setV({ ...v, path: e.target.value })} />
          </label>
        )}
        {v.mode === "api" && (
          <>
            <label className="field">
              Endpoint URL
              <input className="input" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
            </label>
            <label className="field">
              API key environment variable
              <input className="input" value={v.api_key_env} onChange={(e) => setV({ ...v, api_key_env: e.target.value })} />
            </label>
          </>
        )}
        {v.last_sync && <p className="pw-small">Last sync {v.last_sync}: {v.last_result}</p>}
        {err && <p className="pw-down strong">{err}</p>}
      </div>
    </Modal>
  );
}
