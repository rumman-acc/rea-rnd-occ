import { createHash } from "node:crypto";
import { nowIso, todayIsoDate } from "@/server/clock";
import { badRequest, notFound } from "@/server/http";
import { documents, parties } from "./data";
import {
  addDays, applicable, commit, evaluate, isActive, itemList, journal, keyOf, marginPct, open, parseCsv, partyKey, pct, r2,
  toPayload, type State,
} from "./state";
import type {
  Batch, BatchLine, BcLine, BcMode, Domain, ExternalApp, Finding, Job, JobType, LinePayload, PriceEntry, ReplaceMode,
  ReplaceScope, Settings,
} from "./types";
import type { Store } from "@/server/store";

// ---- wire shapes -------------------------------------------------------------------------
// Stored data uses party_no/party_name; the API uses customer_* (sales) or vendor_* (purchase).

type Rec = Record<string, unknown>;

function wp<T extends Rec>(d: Domain, o: T): Rec {
  const key = partyKey(d);
  const { party_no, party_name, ...rest } = o as Rec;
  const out: Rec = { ...rest };
  if (party_no !== undefined) out[`${key}_no`] = party_no;
  if (party_name !== undefined) out[`${key}_name`] = party_name;
  return out;
}

export function entryWire(s: State, e: PriceEntry): Rec {
  const cost = itemList(s).find((i) => i.item_no === e.item_no)?.cost ?? null;
  return wp(s.d, {
    ...e,
    item_blocked: false,
    change_pct: e.prev_price ? pct(((e.price - e.prev_price) / e.prev_price) * 100) : null,
    unit_cost: cost,
    margin_pct: marginPct(s.d, e.price, cost),
  });
}

function lineWire(s: State, l: BatchLine): Rec {
  return { ...l, payload: wp(s.d, l.payload as unknown as Rec), result: l.result.party_no !== undefined ? wp(s.d, l.result) : l.result };
}

export function batchHead(s: State, b: Batch): Rec {
  return {
    id: b.id, label: b.label, source_file: b.source_file, source_kind: b.source_kind, operator: b.operator,
    uploaded_at: b.uploaded_at, status: b.status, lines: b.lines.length,
    applied: b.lines.filter((l) => l.status === "applied").length, summary: b.summary,
    simulated: b.source_kind === "external",
  };
}

export function batchDetail(s: State, b: Batch): Rec {
  return { ...batchHead(s, b), line_rows: b.lines.map((l) => lineWire(s, l)) };
}

export function findBatch(s: State, id: string): Batch {
  const b = s.batches.find((x) => x.id === id);
  if (!b) throw notFound(`Batch ${id} not found`);
  return b;
}

// ---- BC simulation ------------------------------------------------------------------------

const BC_TEXT: Record<BcMode, string> = {
  "two-way": "Simulated Business Central: reads and writes work.",
  "read-only": "Simulated Business Central: price lines can be read but not written.",
  "write-inert": "Simulated Business Central: writes succeed but do not affect document pricing.",
  offline: "Simulated Business Central is offline.",
};

export const bcCanRead = (m: BcMode) => m !== "offline";
export const bcCanWrite = (m: BcMode) => m === "two-way" || m === "write-inert";

export function bcStatus(s: State): Rec {
  const mode = s.settings.bc_mode;
  return {
    simulated: true,
    mode,
    read: bcCanRead(mode),
    write: bcCanWrite(mode),
    detail: BC_TEXT[mode],
    warning: mode === "write-inert" ? "Simulated: the connector accepts writes, but they are treated as not affecting orders. Treat the price book as app-only." : "",
    environment: "Sandbox (simulated)",
    checked_at: nowIso().slice(0, 19),
    lines: s.bc.lines.filter((l) => l.ends_on === null).length,
  };
}

// ---- overview / list -----------------------------------------------------------------------

export function overview(s: State): Rec {
  const active = s.entries.filter(isActive);
  const std = active.filter((e) => e.party_no === "ALL");
  const spec = active.filter((e) => e.party_no !== "ALL");
  const review = s.batches.filter((b) => b.status === "review" || b.status === "partial");
  const key = partyKey(s.d);
  const last = s.runs.at(-1) ?? null;
  const bc = bcStatus(s);
  return {
    book: {
      entries: active.length,
      standard: std.length,
      [`${key}_specific`]: spec.length,
      items: new Set(active.map((e) => e.item_no)).size,
      [`${key}s`]: new Set(spec.map((e) => e.party_no)).size,
      last_updated: active.map((e) => e.updated_at).sort().at(-1) ?? null,
    },
    batches_in_review: review.length,
    lines_pending: review.reduce((n, b) => n + b.lines.filter((l) => l.status === "staged" && l.decision !== "excluded").length, 0),
    open_findings: s.findings.filter((f) => f.status === "open").length,
    last_audit: last ? { ts: last.ts, summary: last.summary } : null,
    bc: { mode: bc.mode, read: bc.read, write: bc.write, detail: bc.detail, warning: bc.warning, simulated: true },
    settings: s.settings,
  };
}

export function list(s: State, scope: string, partyNo: string | undefined): Rec {
  const specific = scope !== "standard";
  const active = s.entries.filter(isActive);
  let rows = active.filter((e) => (specific ? e.party_no !== "ALL" : e.party_no === "ALL"));
  if (specific && partyNo) rows = rows.filter((e) => e.party_no === partyNo);
  rows = rows.sort((a, b) => a.item_no.localeCompare(b.item_no) || a.party_no.localeCompare(b.party_no) || a.min_qty - b.min_qty);
  const key = partyKey(s.d);
  const all = parties(s.store, s.d);
  return {
    rows: rows.map((e) => entryWire(s, e)),
    book: {
      standard: active.filter((e) => e.party_no === "ALL").length,
      [`${key}_specific`]: active.filter((e) => e.party_no !== "ALL").length,
      last_updated: active.map((e) => e.updated_at).sort().at(-1) ?? null,
    },
    [`${key}s`]: all,
    priced: [...new Set(active.filter((e) => e.party_no !== "ALL").map((e) => e.party_no))],
  };
}

// ---- entries -------------------------------------------------------------------------------

function samePricePos(e: { item_no: string; party_no: string; min_qty: number }, p: { item_no: string; party_no: string; min_qty: number }) {
  return e.item_no === p.item_no && e.party_no === p.party_no && e.min_qty === p.min_qty;
}

export function upsertEntry(s: State, body: Rec, operator: string): Rec {
  const key = partyKey(s.d);
  const p = toPayload(s, { ...body, [`${key}no`]: body[`${key}_no`] ?? body.party_no, qty: body.min_qty });
  p.price = Number(body.price);
  if (!p.item_no) throw badRequest("item_no is required");
  if (!(p.price > 0)) throw badRequest("price must be a positive number");
  if (!(p.min_qty >= 0)) throw badRequest("min_qty cannot be negative");
  const ai = evaluate(s, p);
  const hard = ai.flags.find((f) => f.level === "red");
  if (hard) throw badRequest(hard.text);
  const entry = applyEntry(s, p, operator, "Entered manually", null);
  journal(s, operator, "manual_price", `${p.item_no} / ${p.party_no} / ${p.min_qty}`, {
    subject: `${p.item_no} / ${p.party_no} / min ${p.min_qty}`, item_no: p.item_no, [`${key}_no`]: p.party_no, min_qty: p.min_qty,
    price_before: entry.before, price_after: p.price,
  });
  commit(s);
  return { ok: true, entry: entryWire(s, entry.entry), warnings: ai.flags.map((f) => f.text) };
}

/** Insert or update the active entry at the same position; returns the entry and the old price. */
function applyEntry(s: State, p: LinePayload, operator: string, source: string, bcAt: string | null): { entry: PriceEntry; before: number | null; outcome: string } {
  const now = nowIso().slice(0, 19);
  const exist = s.entries.find((e) => isActive(e) && samePricePos(e, p));
  const name = parties(s.store, s.d).find((x) => x.number === p.party_no)?.name ?? "";
  if (exist) {
    const before = exist.price;
    const changed = before !== p.price;
    exist.prev_price = changed ? before : exist.prev_price;
    exist.price = p.price;
    exist.currency = p.currency;
    exist.uom = p.uom ?? exist.uom;
    if (changed) { exist.updated_at = now; exist.updated_by = operator; exist.source = source; exist.effective_from = p.effective_from || todayIsoDate(); }
    if (bcAt) exist.bc_synced_at = bcAt;
    exist.governed = true;
    return { entry: exist, before, outcome: changed ? "updated" : "unchanged" };
  }
  const entry: PriceEntry = {
    item_no: p.item_no, item_description: itemList(s).find((i) => i.item_no === p.item_no)?.description ?? "", party_no: p.party_no,
    party_name: name, min_qty: p.min_qty, price: p.price, prev_price: null, currency: p.currency, uom: p.uom ?? "EA",
    effective_from: p.effective_from || todayIsoDate(), ends_on: null, updated_at: now, updated_by: operator, source,
    bc_synced_at: bcAt, governed: true,
  };
  s.entries.push(entry);
  return { entry, before: null, outcome: "created" };
}

export function deleteEntry(s: State, item: string, party: string, minQty: number, operator: string): Rec {
  const i = s.entries.findIndex((e) => isActive(e) && samePricePos(e, { item_no: item, party_no: party, min_qty: minQty }));
  if (i < 0) throw notFound("Price entry not found");
  const [gone] = s.entries.splice(i, 1);
  journal(s, operator, "delete_price", `${item} / ${party} / ${minQty}`, {
    subject: `${item} / ${party} / min ${minQty}`, item_no: item, [`${partyKey(s.d)}_no`]: party, min_qty: minQty, price_before: gone.price,
  });
  commit(s);
  return { ok: true };
}

// ---- batches -------------------------------------------------------------------------------

interface NewBatch { label: string; source_file: string; source_kind: Batch["source_kind"]; source_text: string; operator: string; rows: LinePayload[] }

export function createBatch(s: State, nb: NewBatch): Batch {
  const hash = createHash("sha1").update(nb.source_text).digest("hex");
  const dup = new Set<string>();
  const seen = new Set<string>();
  for (const r of nb.rows) {
    const k = keyOf(r.item_no, r.party_no, r.min_qty);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  s.counters.batch += 1;
  const lines: BatchLine[] = nb.rows.map((payload, i) => {
    s.counters.line += 1;
    return { id: `L-${s.counters.line}`, row_no: i + 1, payload, ai: evaluate(s, payload, dup), decision: "pending", status: "staged", result: {} };
  });
  const flags: Batch["summary"]["flags"] = [];
  const earlier = nb.source_kind === "upload" ? s.batches.find((b) => b.file_hash === hash) : undefined;
  if (earlier) flags.push({ level: "red", code: "duplicate_file", text: `This exact file was already processed in batch ${earlier.id} on ${earlier.uploaded_at.slice(0, 10)}.` });
  if (lines.length > 0 && lines.every((l) => l.ai.flags.some((f) => f.level === "red"))) flags.push({ level: "red", code: "no_valid_rows", text: "Every row has a blocking problem." });
  const batch: Batch = {
    id: `B-${s.counters.batch}`, label: nb.label, source_file: nb.source_file, source_kind: nb.source_kind, source_text: nb.source_text,
    file_hash: hash, operator: nb.operator, uploaded_at: nowIso().slice(0, 19), status: "review",
    summary: { items: new Set(nb.rows.map((r) => r.item_no)).size, rows: lines.length, flags, targets: { bc_item_card: lines.filter((l) => l.payload.target === "bc_item_card").length } },
    lines, confirmation: null,
  };
  s.batches.push(batch);
  return batch;
}

export function upload(s: State, body: Rec, operator: string): Rec {
  const filename = String(body.filename ?? "").trim();
  if (!filename) throw badRequest("filename is required");
  if (typeof body.content_b64 !== "string" || !body.content_b64) throw badRequest("content_b64 is required");
  if (/\.xlsx?m?$/i.test(filename)) throw badRequest("XLSX files are not supported in this rebuild; save the sheet as CSV and upload that.");
  const text = Buffer.from(body.content_b64, "base64").toString("utf8");
  const rows = parseCsv(text).map((r) => toPayload(s, r));
  const batch = createBatch(s, { label: filename, source_file: filename, source_kind: "upload", source_text: text, operator, rows });
  journal(s, operator, "upload", `${filename} (${rows.length} rows)`, { batch_id: batch.id, batch_label: batch.label, rows: rows.length });
  commit(s);
  return batchDetail(s, batch);
}

function csvOf(s: State, rows: LinePayload[]): string {
  const h = s.d === "sales" ? "Item No,Customer No,Quantity,Price,Currency,Effective Date" : "Item No,Vendor No,Quantity,Price,Currency,Effective Date";
  return [h, ...rows.map((r) => [r.item_no, r.party_no, r.min_qty, r.price, r.currency, r.effective_from ?? ""].join(","))].join("\n");
}

export function derive(s: State, months: number, operator: string): Rec {
  const m = Number.isFinite(months) && months > 0 ? months : 12;
  const since = addDays(todayIsoDate(), -Math.round(m * 30.4));
  const docs = documents(s.store, s.d).filter((x) => x.doc_kind === "invoice" && x.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, (typeof docs)[number]>();
  for (const x of docs) latest.set(`${x.item_no}|${x.party_no}`, x);
  if (latest.size === 0) throw badRequest(`No posted ${s.d === "sales" ? "sales" : "purchase"} invoices in the last ${m} months.`);
  const rows = [...latest.values()].map((x) => ({ ...toPayload(s, { item: x.item_no, party: x.party_no, qty: "0", price: String(x.unit_price) }), effective_from: x.date }));
  const label = `Derived from ${s.d === "sales" ? "invoice" : "purchase invoice"} history (${m} months)`;
  const batch = createBatch(s, { label, source_file: "derived", source_kind: "derive", source_text: csvOf(s, rows), operator, rows });
  journal(s, operator, "derive_from_history", label, { batch_id: batch.id, batch_label: label, rows: rows.length });
  commit(s);
  return batchDetail(s, batch);
}

export function syncExternal(s: State, operator: string): Rec {
  const app = s.settings.external_app;
  if (app.mode === "none") throw badRequest("The external pricing app is not configured. Choose a connection first.");
  const book = s.entries.filter(isActive).slice(0, 5);
  const rows: LinePayload[] = book.map((e) =>
    toPayload(s, { item: e.item_no, party: e.party_no, qty: String(e.min_qty), price: String(r2(e.price * 1.03)) }),
  );
  const extra = itemList(s).find((i) => !book.some((e) => e.item_no === i.item_no)) ?? itemList(s).at(-1)!;
  rows.push(toPayload(s, { item: extra.item_no, party: "ALL", qty: "0", price: String(r2(extra.cost * (s.d === "sales" ? 1.8 : 1.02))) }));
  const label = `External pricing app sync (simulated, ${app.mode})`;
  const batch = createBatch(s, { label, source_file: "external-app (simulated)", source_kind: "external", source_text: csvOf(s, rows), operator, rows });
  s.settings.external_app = { ...app, last_sync: nowIso().slice(0, 19), last_result: `Simulated: ${rows.length} row(s) staged as ${batch.id}` };
  journal(s, operator, "external_sync", label, { batch_id: batch.id, batch_label: label, rows: rows.length, simulated: true });
  commit(s);
  return batchDetail(s, batch);
}

export function pullBc(s: State, operator: string): Rec {
  if (!bcCanRead(s.settings.bc_mode)) throw badRequest("Business Central (simulated) is offline; nothing to pull.");
  const now = nowIso().slice(0, 19);
  let created = 0, updated = 0, unchanged = 0;
  const lines = s.bc.lines.filter((l) => l.ends_on === null);
  for (const l of lines) {
    const p: LinePayload = { item_no: l.item_no, party_no: l.party_no, min_qty: l.min_qty, price: l.price, currency: l.currency, target: "price_book", replace_existing: null };
    if (!itemList(s).some((i) => i.item_no === l.item_no)) continue;
    const r = applyEntry(s, p, "Business Central (simulated)", "Pulled from BC (simulated)", now);
    if (r.outcome === "created") created++; else if (r.outcome === "updated") updated++; else unchanged++;
  }
  journal(s, operator, "pull_from_bc", `${lines.length} BC line(s)`, { bc_lines: lines.length, created, updated, unchanged, simulated: true });
  commit(s);
  return { bc_lines: lines.length, created, updated, unchanged, simulated: true };
}

// ---- review lines ----------------------------------------------------------------------------

export function patchLine(s: State, id: string, body: Rec, operator: string): Rec {
  for (const b of s.batches) {
    const l = b.lines.find((x) => x.id === id);
    if (!l) continue;
    if (l.status !== "staged") throw badRequest("Only staged rows can be edited.");
    const key = partyKey(s.d);
    const inc = (body.payload ?? {}) as Rec;
    if (Object.keys(inc).length) {
      const next: LinePayload = { ...l.payload };
      if (inc.min_qty !== undefined) next.min_qty = Number(inc.min_qty);
      if (inc.price !== undefined) next.price = Number(inc.price);
      if (inc.replace_existing !== undefined) next.replace_existing = inc.replace_existing === null ? null : Boolean(inc.replace_existing);
      const pn = inc[`${key}_no`] ?? inc.party_no;
      if (typeof pn === "string") next.party_no = pn || "ALL";
      if (typeof inc.currency === "string") next.currency = inc.currency;
      next.target = s.d === "sales" && next.party_no === "ALL" && next.min_qty === 0 ? "bc_item_card" : "price_book";
      l.payload = next;
      const dup = new Set(b.lines.filter((x) => x.id !== l.id && keyOf(x.payload.item_no, x.payload.party_no, x.payload.min_qty) === keyOf(next.item_no, next.party_no, next.min_qty)).map(() => keyOf(next.item_no, next.party_no, next.min_qty)));
      l.ai = evaluate(s, next, dup);
      b.summary.targets.bc_item_card = b.lines.filter((x) => x.payload.target === "bc_item_card").length;
      journal(s, operator, "edit_line", `${b.id} row ${l.row_no}`, { batch_id: b.id, batch_label: b.label, row_no: l.row_no, item_no: l.payload.item_no, subject: `${l.payload.item_no} / ${l.payload.party_no}` });
    }
    if (body.decision !== undefined) {
      if (!["pending", "approved", "excluded"].includes(String(body.decision))) throw badRequest("decision must be pending, approved or excluded");
      if (body.decision === "approved" && l.ai.flags.some((f) => f.level === "red")) throw badRequest("A row with a blocking check cannot be approved.");
      l.decision = body.decision as BatchLine["decision"];
    }
    commit(s);
    return lineWire(s, l);
  }
  throw notFound(`Line ${id} not found`);
}

export function recheck(s: State, id: string, operator: string): Rec {
  const b = findBatch(s, id);
  const changes: Rec[] = [];
  let n = 0;
  for (const l of b.lines.filter((x) => x.status === "staged")) {
    n++;
    const before = l.ai;
    l.ai = evaluate(s, l.payload);
    const a = before.flags.map((f) => f.code).sort().join();
    const z = l.ai.flags.map((f) => f.code).sort().join();
    if (a !== z || before.unit_cost !== l.ai.unit_cost) {
      if (l.decision === "approved" && l.ai.flags.some((f) => f.level === "red")) l.decision = "pending";
      if (a !== z) changes.push({ row_no: l.row_no, subject: `${l.payload.item_no} / ${l.payload.party_no}`, unit_cost_before: before.unit_cost, unit_cost_after: l.ai.unit_cost, flags_before: before.flags.map((f) => f.code), flags_after: l.ai.flags.map((f) => f.code) });
    }
  }
  journal(s, operator, "recheck_batch", `${b.id} (${n} rows)`, { batch_id: b.id, batch_label: b.label });
  commit(s);
  return { lines_rechecked: n, lines_changed: changes.length, changes };
}

export function archive(s: State, id: string, operator: string): Rec {
  const b = findBatch(s, id);
  if (b.status === "archived") throw badRequest("Batch is already archived.");
  b.status = "archived";
  journal(s, operator, "settings", `Archived batch ${b.id}`, { batch_id: b.id, batch_label: b.label, note: "archived" });
  commit(s);
  return batchHead(s, b);
}

// ---- replace preview and apply -----------------------------------------------------------------

const SCOPE_LABEL: Record<ReplaceScope, (s: State) => string> = {
  price: () => "only the price each row replaces (same item, party and quantity break)",
  item_party: (s) => `each row's item for that ${partyKey(s.d)}, every quantity break`,
  item_all: (s) => `each row's item for every ${partyKey(s.d)}`,
};

function normScope(v: unknown): ReplaceScope {
  if (v === undefined || v === null || v === "price") return "price";
  if (v === "item_customer" || v === "item_vendor" || v === "item_party") return "item_party";
  if (v === "item_all") return "item_all";
  throw badRequest("replace_scope must be price, item_customer/item_vendor or item_all");
}

function normMode(v: unknown): ReplaceMode {
  if (v === undefined || v === null || v === "retire") return "retire";
  if (v === "delete") return "delete";
  throw badRequest("replace_mode must be retire or delete");
}

const matcher = (p: LinePayload, scope: ReplaceScope) => (x: { item_no: string; party_no: string; min_qty: number }) =>
  x.item_no === p.item_no && (scope === "item_all" || x.party_no === p.party_no) && (scope !== "price" || x.min_qty === p.min_qty);

function selected(b: Batch, ids: unknown): BatchLine[] {
  const set = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  return b.lines.filter((l) => l.status === "staged" && l.decision === "approved" && (!set || set.has(l.id)));
}

export function replacePreview(s: State, id: string, body: Rec): Rec {
  const b = findBatch(s, id);
  const scope = normScope(body.replace_scope);
  const mode = normMode(body.replace_mode);
  const rows: Rec[] = [];
  let bookTotal = 0, bcTotal = 0;
  const key = partyKey(s.d);
  for (const l of selected(b, undefined)) {
    const m = matcher(l.payload, scope);
    const exactOnly = scope === "price" && mode === "retire";
    const book = s.entries.filter((e) => isActive(e) && m(e) && !(exactOnly && samePricePos(e, l.payload)));
    const bc = s.bc.lines.filter((x) => x.ends_on === null && m(x));
    bookTotal += book.length;
    bcTotal += bc.length;
    if (book.length || bc.length) {
      rows.push({ row_no: l.row_no, item_no: l.payload.item_no, [`${key}_no`]: l.payload.party_no, book_count: book.length, bc_count: bc.length, book: book.map((e) => ({ price: e.price, min_qty: e.min_qty })) });
    }
  }
  return {
    book_total: bookTotal, bc_total: bcTotal, rows, scope_label: SCOPE_LABEL[scope](s), bc_readable: bcCanRead(s.settings.bc_mode),
    legacy_note: "Simulated connector: counts come from the local simulated Business Central price list, not a real system.",
    simulated: true,
  };
}

export function execute(s: State, id: string, body: Rec, operator: string): Rec {
  const b = findBatch(s, id);
  if (b.status === "archived") throw badRequest("Archived batches cannot be applied.");
  const scope = normScope(body.replace_scope);
  const mode = normMode(body.replace_mode);
  const replaceDefault = body.replace_existing === true;
  const protect = body.protect_governed !== false;
  const pushBc = s.d === "sales" && body.push_to_bc === true;
  const write = bcCanWrite(s.settings.bc_mode);
  const lines = selected(b, body.line_ids);
  if (lines.length === 0) throw badRequest("No approved rows to apply.");
  const key = partyKey(s.d);
  const now = nowIso().slice(0, 19);
  const results: Rec[] = [];
  let applied = 0, failed = 0, prot = 0, cards = 0;

  for (const l of lines) {
    const p = l.payload;
    const base = { line_id: l.id, row_no: l.row_no, item_no: p.item_no, [`${key}_no`]: p.party_no };
    const red = l.ai.flags.find((f) => f.level === "red");
    if (red) {
      l.status = "failed";
      l.result = { error: red.text, outcome: "rejected" };
      failed++;
      results.push({ ...base, status: "failed", error: red.text });
      journal(s, operator, "price_failed", `${p.item_no} / ${p.party_no}`, { subject: `${p.item_no} / ${p.party_no} / min ${p.min_qty}`, batch_id: b.id, batch_label: b.label, row_no: l.row_no, error: red.text }, "failed");
      continue;
    }
    const replace = p.replace_existing ?? replaceDefault;
    let history = false;
    if (replace) {
      const m = matcher(p, scope);
      const end = addDays(p.effective_from || todayIsoDate(), -1);
      const exactKeep = scope === "price" && mode === "retire";
      if (mode === "delete") s.entries = s.entries.filter((e) => !(isActive(e) && m(e)));
      else for (const e of s.entries) if (isActive(e) && m(e) && !(exactKeep && samePricePos(e, p))) e.ends_on = end;
      if (write) {
        for (const x of s.bc.lines) if (x.ends_on === null && m(x)) { history = history || samePricePos(x, p); if (mode === "retire") x.ends_on = end; }
        if (mode === "delete") s.bc.lines = s.bc.lines.filter((x) => !(x.ends_on === null && m(x)));
      }
    } else if (protect) {
      const ex = s.entries.find((e) => isActive(e) && samePricePos(e, p));
      if (ex && ex.governed && ex.price !== p.price) {
        prot++;
        l.result = { outcome: "protected" };
        results.push({ ...base, status: "protected" });
        continue;
      }
    }
    const r = applyEntry(s, p, operator, b.label, write ? now : null);
    let bcCard: string | undefined;
    let bcList: string | undefined;
    if (write) {
      const existing = s.bc.lines.find((x) => x.ends_on === null && samePricePos(x, p));
      if (existing) existing.price = p.price;
      else s.bc.lines.push({ item_no: p.item_no, party_no: p.party_no, min_qty: p.min_qty, price: p.price, currency: p.currency, ends_on: null });
      bcList = `price list line ${existing ? "updated" : "written"} (simulated)`;
      if (pushBc && p.target === "bc_item_card") {
        const old = s.bc.item_cards[p.item_no];
        s.bc.item_cards[p.item_no] = p.price;
        bcCard = `unit price ${old ?? "n/a"} -> ${p.price} (simulated)`;
        cards++;
      }
    }
    l.status = "applied";
    l.result = { outcome: r.outcome, prev_price: r.before, ...(bcCard ? { bc_item_card: bcCard } : {}), ...(bcList ? { bc_price_list: bcList } : {}) };
    applied++;
    results.push({ ...base, status: "applied", outcome: r.outcome, prev_price: r.before, bc_item_card: bcCard, bc_history_line: history && mode === "retire" });
    if (r.outcome !== "unchanged") {
      journal(s, operator, "price_changed", `${p.item_no} / ${p.party_no}`, {
        subject: `${p.item_no} / ${p.party_no} / min ${p.min_qty}`, item_no: p.item_no, [`${key}_no`]: p.party_no, min_qty: p.min_qty,
        price_before: r.before, price_after: p.price, batch_id: b.id, batch_label: b.label, row_no: l.row_no, target: p.target,
        bc_item_card: bcCard, bc_price_list: bcList,
      });
    }
  }
  const staged = b.lines.some((l) => l.status === "staged" && l.decision !== "excluded");
  const anyApplied = b.lines.some((l) => l.status === "applied");
  b.status = staged ? (anyApplied ? "partial" : "review") : anyApplied ? "applied" : "failed";
  const conf = ["Row,Item," + (s.d === "sales" ? "Customer" : "Vendor") + ",MinQty,Price,Status,Outcome,Note"];
  for (const l of b.lines) conf.push([l.row_no, l.payload.item_no, l.payload.party_no, l.payload.min_qty, l.payload.price, l.status, l.result.outcome ?? "", String(l.result.error ?? "")].join(","));
  b.confirmation = conf.join("\n");
  journal(s, operator, "apply", `${b.id}: ${applied} applied, ${failed} failed`, { batch_id: b.id, batch_label: b.label, applied, failed, protected: prot, replace_mode: mode, replace_scope: scope });
  commit(s);
  return { batch_id: b.id, status: b.status, applied, failed, protected: prot, bc_item_cards_updated: cards, results, confirmation: true };
}

// ---- settings --------------------------------------------------------------------------------------

export function putSettings(s: State, body: Rec, operator: string): Settings {
  const v = (body.values ?? body) as Rec;
  const next: Settings = { ...s.settings };
  const numField = (name: "margin_floor_pct" | "max_change_pct" | "overhead_pct", lo: number, hi: number) => {
    if (v[name] === undefined) return;
    const n = Number(v[name]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw badRequest(`${name} must be a number between ${lo} and ${hi}`);
    next[name] = n;
  };
  numField("margin_floor_pct", 0, 100);
  numField("max_change_pct", 1, 1000);
  numField("overhead_pct", 0, 1000);
  if (v.bc_mode !== undefined) {
    if (!["two-way", "read-only", "write-inert", "offline"].includes(String(v.bc_mode))) throw badRequest("bc_mode is not valid");
    next.bc_mode = v.bc_mode as BcMode;
  }
  if (v.external_app !== undefined) {
    const e = v.external_app as Partial<ExternalApp>;
    if (e.mode !== undefined && !["none", "file", "api"].includes(String(e.mode))) throw badRequest("external_app.mode must be none, file or api");
    next.external_app = { ...next.external_app, ...e, last_sync: next.external_app.last_sync, last_result: next.external_app.last_result };
  }
  s.settings = next;
  journal(s, operator, "settings", "Settings saved", { note: "settings saved" });
  commit(s);
  return next;
}

// ---- audit (deterministic rules, not an LLM) -----------------------------------------------------------

const fp = (check: string, key: string) => `F-${check}-${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;

export function runAudit(s: State, windowDays: number, operator: string): Rec {
  const win = Math.round(windowDays);
  if (!Number.isFinite(win) || win < 30 || win > 730) throw badRequest("window_days must be between 30 and 730");
  const since = addDays(todayIsoDate(), -win);
  const docs = documents(s.store, s.d).filter((x) => x.date >= since);
  const sales = s.d === "sales";
  const its = itemList(s);
  const found: Finding[] = [];
  const today = nowIso().slice(0, 19);
  const key = partyKey(s.d);
  const add = (check_id: string, k: string, severity: Finding["severity"], kind: Finding["kind"], title: string, impact: number, detail: Rec) =>
    found.push({ fingerprint: fp(check_id, k), severity, kind, check_id, title, impact: r2(Math.max(0, impact)), status: "open", first_seen: today, last_seen: today, note: "", detail });
  const det = (x: (typeof docs)[number]) => ({ [`${key}_no`]: x.party_no, [`${key}_name`]: x.party_name, documents: [x.doc_no], doc_kind: x.doc_kind === "order" ? "order" : "invoice", items: [x.item_no] });

  for (const x of docs) {
    const cost = its.find((i) => i.item_no === x.item_no)?.cost ?? null;
    const book = applicable(s, x.item_no, x.party_no, x.qty);
    const who = `${x.doc_kind === "order" ? "Order" : "Invoice"} ${x.doc_no}`;
    if (!book) { add("PA-04", x.doc_no + x.item_no, "medium", "risk", `${who}: ${x.item_no} has no price in the book.`, 0, det(x)); }
    else {
      const diff = (x.unit_price - book.price) / book.price;
      const adverse = sales ? diff < -0.001 : diff > 0.001;
      if (adverse) add("PA-01", x.doc_no + x.item_no, Math.abs(diff) > 0.1 ? "high" : "medium", "risk", `${who}: ${sales ? "priced" : "paid"} ${r2(x.unit_price)} against a book price of ${book.price} for ${x.item_no} (${pct(diff * 100)}%).`, Math.abs(x.unit_price - book.price) * x.qty, det(x));
      else if (Math.abs(diff) > 0.001) add("PA-02", x.doc_no + x.item_no, "low", "risk", `${who}: ${x.item_no} ${sales ? "charged" : "paid"} ${pct(Math.abs(diff) * 100)}% ${sales ? "above" : "below"} the book price.`, 0, det(x));
      if (book.updated_at.slice(0, 10) < addDays(todayIsoDate(), -365)) add("PA-08", `${book.item_no}${book.party_no}${book.min_qty}`, "low", "risk", `Price for ${book.item_no} has not changed in over a year.`, 0, det(x));
    }
    if (cost !== null) {
      if (sales && x.unit_price < cost) add("PA-03", x.doc_no + x.item_no, "high", "risk", `${who}: ${x.item_no} sold below unit cost (${x.unit_price} < ${cost}).`, (cost - x.unit_price) * x.qty, det(x));
      else if (sales && marginPct(s.d, x.unit_price, cost)! < s.settings.margin_floor_pct) add("PA-06", x.doc_no + x.item_no, "medium", "risk", `${who}: margin on ${x.item_no} is under ${s.settings.margin_floor_pct}%.`, 0, det(x));
      if (!sales && x.unit_price > cost * (1 + s.settings.max_change_pct / 100)) add("PA-03", x.doc_no + x.item_no, "high", "risk", `${who}: ${x.item_no} paid ${x.unit_price} against a last cost of ${cost}.`, (x.unit_price - cost) * x.qty, det(x));
    }
  }
  const groups = new Map<string, typeof docs>();
  for (const x of docs) groups.set(`${x.party_no}|${x.item_no}`, [...(groups.get(`${x.party_no}|${x.item_no}`) ?? []), x]);
  for (const [g, xs] of groups) {
    const ps = xs.map((x) => x.unit_price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    if (xs.length > 1 && (hi - lo) / hi > 0.05) add("PA-05", g, "medium", "risk", `${xs[0].party_name}: ${xs[0].item_no} was ${sales ? "invoiced" : "bought"} at ${lo} to ${hi} across ${xs.length} documents.`, (hi - lo) * Math.min(...xs.map((x) => x.qty)), { ...det(xs[0]), documents: xs.map((x) => x.doc_no) });
  }
  if (sales) {
    for (const e of s.entries.filter((x) => isActive(x) && x.party_no !== "ALL")) {
      const std = s.entries.find((x) => isActive(x) && x.item_no === e.item_no && x.party_no === "ALL" && x.min_qty === 0);
      const cost = its.find((i) => i.item_no === e.item_no)?.cost ?? null;
      const m = marginPct(s.d, e.price, cost);
      if (std && e.price < std.price * 0.97 && m !== null && m > 60) add("PA-07", `${e.item_no}${e.party_no}${e.min_qty}`, "low", "opportunity", `${e.party_name} pays ${e.price} for ${e.item_no} against a standard ${std.price} while margin stays at ${m}%: room to review.`, (std.price - e.price) * 10, { customer_no: e.party_no, customer_name: e.party_name, items: [e.item_no], documents: [] });
    }
  } else {
    for (const x of docs.filter((y) => y.doc_kind === "invoice")) {
      const cheapest = s.entries.filter((e) => isActive(e) && e.item_no === x.item_no && e.min_qty === 0).sort((a, b) => a.price - b.price)[0];
      if (cheapest && cheapest.party_no !== x.party_no && x.unit_price > cheapest.price * 1.05) add("PA-07", x.doc_no + x.item_no, "low", "opportunity", `${x.item_no} was bought from ${x.party_name} at ${x.unit_price}; the book has ${cheapest.price}.`, (x.unit_price - cheapest.price) * x.qty, det(x));
    }
  }

  // Merge with existing findings so reviewer decisions survive a re-run.
  const merged: Finding[] = [];
  for (const f of found) {
    const old = s.findings.find((x) => x.fingerprint === f.fingerprint);
    merged.push(old ? { ...f, status: old.status === "resolved" ? "open" : old.status, first_seen: old.first_seen, note: old.note } : f);
  }
  for (const old of s.findings) if (!merged.some((f) => f.fingerprint === old.fingerprint)) merged.push(old.status === "open" ? { ...old, status: "resolved" } : old);
  s.findings = merged;
  const open = merged.filter((f) => f.status === "open");
  const counts = { high: open.filter((f) => f.severity === "high").length, medium: open.filter((f) => f.severity === "medium").length, low: open.filter((f) => f.severity === "low").length };
  const impact = r2(open.filter((f) => f.kind === "risk").reduce((n, f) => n + f.impact, 0));
  const rating = counts.high ? "at risk" : counts.medium ? "watch" : "clean";
  const recs: string[] = [];
  if (counts.high) recs.push(`Review the ${counts.high} high-severity finding(s) first.`);
  if (counts.medium) recs.push(`Resolve the ${counts.medium} medium finding(s), usually by correcting the book or the document.`);
  if (open.some((f) => f.kind === "opportunity")) recs.push("Opportunities are suggestions from fixed rules; confirm them commercially.");
  if (!recs.length) recs.push("No action needed.");
  const summary = {
    engine: "Deterministic rule-based checker (not an LLM)", rating,
    narrative: `${open.length} open finding(s) across ${docs.length} document(s) in the last ${win} days.`,
    recommendations: recs, counts, risk_impact: impact, priced_lines: docs.length, documents_scanned: new Set(docs.map((x) => x.doc_no)).size,
  };
  const run = { ts: today, operator, window_days: win, summary };
  s.runs.push(run);
  journal(s, operator, "audit_run", `${open.length} open finding(s)`, { note: `window ${win} days`, findings: open.length });
  commit(s);
  return { run: { ...run }, findings: open.length };
}

export function auditView(s: State, status: string | null): Rec {
  const f = s.findings.filter((x) => !status || x.status === status).map((x) => wp(s.d, { ...x }));
  return { findings: f, last_run: s.runs.at(-1) ?? null };
}

export function patchFinding(s: State, fingerprint: string, body: Rec, operator: string): Rec {
  const f = s.findings.find((x) => x.fingerprint === fingerprint);
  if (!f) throw notFound("Finding not found");
  const st = String(body.status ?? "");
  if (!["open", "reviewed", "dismissed", "resolved"].includes(st)) throw badRequest("status must be open, reviewed, dismissed or resolved");
  const note = String(body.note ?? "").trim();
  if (st === "dismissed" && !note) throw badRequest("A note is required to dismiss a finding.");
  f.status = st as Finding["status"];
  if (note) f.note = note;
  journal(s, operator, "audit_run", `Finding ${f.check_id} marked ${st}`, { note: note || `marked ${st}` });
  commit(s);
  return wp(s.d, { ...f });
}

// ---- jobs ------------------------------------------------------------------------------------------------

const JOB_TYPES: JobType[] = ["inbox", "audit", "sync", "pull_bc"];

export function saveJob(s: State, body: Rec, operator: string): Job {
  const j = body.job as Partial<Job> | undefined;
  if (!j || typeof j !== "object") throw badRequest("job is required");
  if (!JOB_TYPES.includes(j.job_type as JobType)) throw badRequest("job_type must be inbox, audit, sync or pull_bc");
  const freq = j.schedule?.frequency;
  if (!freq || !["daily", "weekly", "hourly"].includes(freq)) throw badRequest("schedule.frequency must be daily, weekly or hourly");
  const old = j.id ? s.jobs.find((x) => x.id === j.id) : undefined;
  if (j.id && !old) throw notFound("Job not found");
  const job: Job = {
    id: old?.id ?? `J-${++s.counters.job}`, name: String(j.name ?? ""), job_type: j.job_type as JobType, enabled: j.enabled !== false,
    schedule: j.schedule!, criteria: j.criteria ?? {}, last_run: old?.last_run ?? null, last_result: old?.last_result ?? null,
  };
  if (old) s.jobs[s.jobs.indexOf(old)] = job; else s.jobs.push(job);
  journal(s, operator, "settings", `Job ${job.name || job.id} saved`, { note: "job saved" });
  commit(s);
  return job;
}

export function deleteJob(s: State, id: string, operator: string): Rec {
  const i = s.jobs.findIndex((x) => x.id === id);
  if (i < 0) throw notFound("Job not found");
  s.jobs.splice(i, 1);
  journal(s, operator, "settings", `Job ${id} deleted`, { note: "job deleted" });
  commit(s);
  return { ok: true };
}

/** "Run now" is a local simulation of the scheduled agent. */
export function runJob(store: Store, d: Domain, id: string, operator: string): Job {
  let s = open(store, d);
  const job = s.jobs.find((x) => x.id === id);
  if (!job) throw notFound("Job not found");
  let result: Record<string, unknown>;
  try {
    if (job.job_type === "audit") {
      const r = runAudit(s, Number(job.criteria.window_days ?? 180), operator) as { findings: number };
      result = { status: "ok", findings: r.findings };
    } else if (job.job_type === "sync") {
      result = { status: "ok", note: "simulated", rows: ((syncExternal(s, operator) as { line_rows: unknown[] }).line_rows).length };
    } else if (job.job_type === "pull_bc") {
      result = { status: "ok", ...(pullBc(s, operator) as Rec) };
    } else {
      result = { status: "ok", files: 0, note: "Folder watching is simulated; no filesystem is read." };
    }
  } catch (e) {
    result = { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
  s = open(store, d);
  const j = s.jobs.find((x) => x.id === id)!;
  j.last_run = nowIso().slice(0, 19);
  j.last_result = result;
  journal(s, operator, "job_run", `${j.name || j.id}: ${String(result.status)}`, { note: String(result.error ?? "ran") }, result.status === "ok" ? "ok" : "failed");
  commit(s);
  return j;
}

export function sourceText(b: Batch): string {
  return b.source_text;
}
