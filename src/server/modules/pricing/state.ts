import { appendAudit } from "@/server/audit";
import { nowIso, todayIsoDate } from "@/server/clock";
import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";
import { DEFAULT_SETTINGS, items, parties, seedBc, seedBook, seedJobs, type Item } from "./data";
import type {
  AuditRun, BcState, Batch, Domain, Finding, Flag, Job, LineAi, LinePayload, LogEntry, PriceEntry, Settings,
} from "./types";

/** Loaded working copy of one domain's documents. Mutate, then `commit`. */
export interface State {
  d: Domain;
  store: Store;
  entries: PriceEntry[];
  batches: Batch[];
  log: LogEntry[];
  findings: Finding[];
  runs: AuditRun[];
  jobs: Job[];
  settings: Settings;
  bc: BcState;
  counters: { batch: number; line: number; job: number };
}

const k = (d: Domain, n: string) => `pricing:${d}:${n}`;

export function open(store: Store, d: Domain): State {
  const entries = store.get(k(d, "entries"), () => seedBook(store, d));
  return {
    d, store, entries,
    batches: store.get(k(d, "batches"), () => [] as Batch[]),
    log: store.get(k(d, "log"), () => [] as LogEntry[]),
    findings: store.get(k(d, "findings"), () => [] as Finding[]),
    runs: store.get(k(d, "runs"), () => [] as AuditRun[]),
    jobs: store.get(k(d, "jobs"), () => seedJobs()),
    settings: store.get(k(d, "settings"), () => DEFAULT_SETTINGS(d)),
    bc: store.get(k(d, "bc"), () => seedBc(seedBook(store, d), d)),
    counters: store.get(k(d, "counters"), () => ({ batch: 0, line: 0, job: 2 })),
  };
}

export function commit(s: State): void {
  const { store, d } = s;
  store.set(k(d, "entries"), s.entries);
  store.set(k(d, "batches"), s.batches);
  store.set(k(d, "log"), s.log);
  store.set(k(d, "findings"), s.findings);
  store.set(k(d, "runs"), s.runs);
  store.set(k(d, "jobs"), s.jobs);
  store.set(k(d, "settings"), s.settings);
  store.set(k(d, "bc"), s.bc);
  store.set(k(d, "counters"), s.counters);
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (n: number) => Math.round(n * 10) / 10;

export const partyKey = (d: Domain) => (d === "sales" ? "customer" : "vendor");

export function addDays(iso: string, days: number): string {
  const [y, m, dd] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + days)).toISOString().slice(0, 10);
}

export const keyOf = (item: string, party: string, qty: number) => `${item}|${party}|${qty}`;
export const isActive = (e: PriceEntry) => e.ends_on === null || e.ends_on >= todayIsoDate();

export function journal(s: State, operator: string, action: string, ref: string, detail: Record<string, unknown> = {}, outcome: "ok" | "failed" = "ok"): void {
  s.log.push({ id: (s.log.at(-1)?.id ?? 0) + 1, ts: nowIso().slice(0, 19), operator, action, outcome, ref, detail });
  appendAudit(s.store, { source: "pricing", actor: operator, action: `${s.d}:${action}`, detail: ref });
}

export function itemList(s: State): Item[] {
  return items(s.store, s.d, s.settings.overhead_pct);
}

/** Active entry that applies to (item, party, qty): party-specific first, then the standard price. */
export function applicable(s: State, item: string, party: string, qty: number): PriceEntry | null {
  const best = (p: string) =>
    s.entries
      .filter((e) => isActive(e) && e.item_no === item && e.party_no === p && e.min_qty <= qty)
      .sort((a, b) => b.min_qty - a.min_qty)[0] ?? null;
  return (party !== "ALL" ? best(party) : null) ?? best("ALL");
}

/** Margin (sales) or saving versus last cost (purchase), in percent. */
export function marginPct(d: Domain, price: number, cost: number | null): number | null {
  if (cost === null || !price || !cost) return null;
  return pct(d === "sales" ? ((price - cost) / price) * 100 : ((cost - price) / cost) * 100);
}

export function evaluate(s: State, p: LinePayload, dupKeys: Set<string> = new Set()): LineAi {
  const flags: Flag[] = [];
  const red = (code: string, text: string) => flags.push({ level: "red", code, text });
  const yellow = (code: string, text: string) => flags.push({ level: "yellow", code, text });
  const item = itemList(s).find((i) => i.item_no === p.item_no);
  const party = parties(s.store, s.d).find((x) => x.number === p.party_no);
  const exact = s.entries.find((e) => isActive(e) && e.item_no === p.item_no && e.party_no === p.party_no && e.min_qty === p.min_qty) ?? null;
  const app = applicable(s, p.item_no, p.party_no, p.min_qty);
  const cost = item?.cost ?? null;
  const price = Number(p.price);
  const sales = s.d === "sales";

  if (!item) red("item_not_found", `Item ${p.item_no} is not in the ${sales ? "finished goods" : "component"} master data.`);
  if (p.party_no !== "ALL" && !party) red("party_not_found", `${sales ? "Customer" : "Vendor"} ${p.party_no} does not exist.`);
  if (!Number.isFinite(price) || price <= 0) red("price_invalid", "Price must be a positive number.");
  if (!Number.isFinite(p.min_qty) || p.min_qty < 0) red("qty_invalid", "Minimum quantity cannot be negative.");
  const margin = Number.isFinite(price) && price > 0 ? marginPct(s.d, price, cost) : null;
  if (margin !== null) {
    if (sales) {
      if (margin < 0) red("below_cost", `Price is below the unit cost (${cost}).`);
      else if (margin < s.settings.margin_floor_pct) yellow("low_margin", `Margin ${margin}% is under the ${s.settings.margin_floor_pct}% floor.`);
    } else if (margin < -s.settings.max_change_pct) red("price_far_above_cost", `Price is more than ${s.settings.max_change_pct}% above the last cost.`);
    else if (margin < 0) yellow("above_last_cost", "Price is above the last cost paid.");
    else if (margin > 40) yellow("far_below_cost", "Price is more than 40% under the last cost; confirm it is not a typo.");
  }
  let delta: number | null = null;
  if (exact && price > 0) {
    delta = pct(((price - exact.price) / exact.price) * 100);
    if (delta === 0) yellow("no_change", "Same as the current price.");
    else if (Math.abs(delta) > s.settings.max_change_pct) yellow("big_change", `Changes the current price by ${delta}%.`);
  }
  const std = s.entries.find((e) => isActive(e) && e.item_no === p.item_no && e.party_no === "ALL" && e.min_qty === 0);
  if (p.party_no !== "ALL" && std && price > std.price) yellow("above_standard", `Above the standard price (${std.price}).`);
  if (dupKeys.has(keyOf(p.item_no, p.party_no, p.min_qty))) yellow("duplicate_row", "Another row in this file has the same item, party and quantity break.");
  return {
    current_price: exact?.price ?? null,
    applicable_price: app?.price ?? null,
    unit_cost: cost,
    margin_pct: margin,
    delta_pct: delta,
    flags,
  };
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,]/g, "")));

/** Normalise one parsed row (any of the usual column names) into a line payload. */
export function toPayload(s: State, raw: Record<string, unknown>): LinePayload {
  const pick = (...names: string[]) => {
    for (const n of names) if (raw[n] !== undefined && String(raw[n]).trim() !== "") return String(raw[n]).trim();
    return "";
  };
  const item_no = pick("item", "itemno", "item_no", "no");
  const partyRaw = pick("customerno", "customer_no", "customer", "vendorno", "vendor_no", "vendor", "party_no", "party");
  const party_no = partyRaw === "" || partyRaw.toUpperCase() === "ALL" ? "ALL" : partyRaw;
  const min_qty = num(pick("quantity", "qty", "minqty", "min_qty") || 0);
  const price = num(pick("price", "unitprice", "unit_price", "cost", "unitcost"));
  const item = itemList(s).find((i) => i.item_no === item_no);
  const party = parties(s.store, s.d).find((x) => x.number === party_no);
  const eff = pick("effectivedate", "effective_date", "effective_from", "effectivefrom");
  return {
    item_no, item_description: item?.description ?? "", party_no, party_name: party?.name ?? "", min_qty, price,
    currency: (pick("currency") || "USD").toUpperCase(), uom: pick("uom") || "EA", effective_from: eff,
    target: s.d === "sales" && party_no === "ALL" && min_qty === 0 ? "bc_item_card" : "price_book",
    replace_existing: null,
  };
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { cur.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      cur.push(cell); cell = "";
      if (cur.some((x) => x.trim() !== "")) rows.push(cur);
      cur = [];
    } else cell += c;
  }
  cur.push(cell);
  if (cur.some((x) => x.trim() !== "")) rows.push(cur);
  if (rows.length < 2) throw badRequest("The file has no data rows.");
  const head = rows[0].map((h) => h.toLowerCase().replace(/[\s_.-]+/g, ""));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
