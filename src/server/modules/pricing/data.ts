import { master } from "@/server/master";
import type { Store } from "@/server/store";
import type { BcState, Document, Domain, Job, PriceEntry, Settings } from "./types";

// Items, parties, document history and seeds, all derived from master data (P).

export interface Item {
  item_no: string;
  description: string;
  series: string;
  blocked: boolean;
  /** Sales: BOM material roll-up x (1 + overhead). Purchase: the component last cost. */
  cost: number;
}

export const DEFAULT_SETTINGS = (d: Domain): Settings => ({
  margin_floor_pct: 15,
  max_change_pct: 25,
  overhead_pct: 150,
  bc_mode: d === "sales" ? "two-way" : "write-inert",
  external_app: { mode: "none", path: "", url: "", api_key_env: "PRICING_APP_KEY", last_sync: "", last_result: "" },
});

const r2 = (n: number) => Math.round(n * 100) / 100;

export function items(store: Store, d: Domain, overheadPct: number): Item[] {
  if (d === "purchase") {
    return master(store, "components").map((c) => ({
      item_no: c.item_no, description: c.description, series: "", blocked: false, cost: c.unit_cost,
    }));
  }
  const comps = master(store, "components");
  const bom = master(store, "bom");
  return master(store, "fg_items").map((f) => {
    const material = bom
      .filter((b) => b.fg_item_no === f.item_no)
      .reduce((s, b) => s + b.qty_per * (comps.find((c) => c.item_no === b.component_item_no)?.unit_cost ?? 0), 0);
    return { item_no: f.item_no, description: f.description, series: f.series, blocked: false, cost: r2(material * (1 + overheadPct / 100)) };
  });
}

export function parties(store: Store, d: Domain): { number: string; name: string }[] {
  return d === "sales"
    ? master(store, "customers").map((c) => ({ number: c.id, name: c.name }))
    : master(store, "vendors").map((v) => ({ number: v.id, name: v.name }));
}

const T0 = "2026-09-01T08:00:00";

function entry(item: Item, party: string, name: string, min_qty: number, price: number, source: string, bc: boolean): PriceEntry {
  return {
    item_no: item.item_no, item_description: item.description, party_no: party, party_name: name, min_qty, price,
    prev_price: null, currency: "USD", uom: "EA", effective_from: "2026-09-01", ends_on: null, updated_at: T0,
    updated_by: "Alex Morgan", source, bc_synced_at: bc ? T0 : null, governed: true,
  };
}

export function seedBook(store: Store, d: Domain): PriceEntry[] {
  const its = items(store, d, DEFAULT_SETTINGS(d).overhead_pct);
  const byNo = (n: string) => its.find((i) => i.item_no === n)!;
  const src = "Initial price book (seed)";
  if (d === "sales") {
    const std: [string, number][] = [["FG-1000", 685], ["FG-2000", 540], ["FG-3000", 3200], ["FG-6000", 8900]];
    const out = std.map(([n, p]) => entry(byNo(n), "ALL", "", 0, p, src, true));
    const cs: [string, string, string, number, number][] = [
      ["FG-1000", "C-01", "Northwind Water Utilities", 0, 665],
      ["FG-1000", "C-01", "Northwind Water Utilities", 10, 645],
      ["FG-1000", "C-03", "Meridian Oil & Gas", 0, 675],
      ["FG-3000", "C-04", "Lakeview Municipal Water", 0, 3150],
      ["FG-3000", "C-07", "Harbor Marine Supply", 2, 3100],
      ["FG-6000", "C-05", "Sterling Chemical Works", 0, 8800],
    ];
    return out.concat(cs.map(([n, p, nm, q, pr]) => entry(byNo(n), p, nm, q, pr, src, false)));
  }
  const vendors = master(store, "vendors");
  const comps = master(store, "components");
  const out: PriceEntry[] = [];
  for (const c of comps) out.push(entry(byNo(c.item_no), "ALL", "", 0, c.unit_cost, src, false));
  for (const c of comps) {
    const v = vendors.find((x) => x.id === c.vendor_id)!;
    out.push(entry(byNo(c.item_no), v.id, v.name, 0, r2(c.unit_cost * 0.97), src, true));
    if (c.unit_cost < 100) out.push(entry(byNo(c.item_no), v.id, v.name, 100, r2(c.unit_cost * 0.93), src, true));
  }
  return out;
}

export function seedBc(book: PriceEntry[], d: Domain): BcState {
  const lines = book.map((e) => ({ item_no: e.item_no, party_no: e.party_no, min_qty: e.min_qty, price: e.price, currency: e.currency, ends_on: null as string | null }));
  // Deterministic drift: one line differs in BC, one exists only in BC (pull-from-BC demo).
  if (lines.length > 2) lines[1] = { ...lines[1], price: r2(lines[1].price * 1.02) };
  const first = book[0];
  lines.push({ item_no: first.item_no, party_no: book.find((e) => e.party_no !== "ALL")?.party_no ?? "ALL", min_qty: 50, price: r2(first.price * 0.9), currency: "USD", ends_on: null });
  const item_cards: Record<string, number> = {};
  if (d === "sales") for (const e of book) if (e.party_no === "ALL" && e.min_qty === 0) item_cards[e.item_no] = e.price;
  return { lines, item_cards };
}

export function seedJobs(): Job[] {
  return [
    { id: "J-1", name: "Nightly audit sweep", job_type: "audit", enabled: true, schedule: { frequency: "daily", time: "02:00" }, criteria: { window_days: 180 }, last_run: null, last_result: null },
    { id: "J-2", name: "External app sync", job_type: "sync", enabled: false, schedule: { frequency: "weekly", time: "06:00", weekday: 0 }, criteria: {}, last_run: null, last_result: null },
  ];
}

/** Open order lines plus deterministic posted-invoice history (all synthetic, P). */
export function documents(store: Store, d: Domain): Document[] {
  const its = items(store, d, DEFAULT_SETTINGS(d).overhead_pct);
  const ps = parties(store, d);
  const pn = (n: string) => ps.find((p) => p.number === n)?.name ?? n;
  const find = (n: string) => its.find((i) => i.item_no === n);
  const mk = (doc_no: string, kind: Document["doc_kind"], party: string, item: string, qty: number, price: number, date: string, po: string | null): Document => ({
    doc_no, doc_kind: kind, party_no: party, party_name: pn(party), item_no: item, description: find(item)?.description ?? "",
    series: find(item)?.series ?? "", model: find(item)?.series ? `M${find(item)!.series}` : "", qty, unit_price: price, date,
    status: kind === "order" ? "open" : "completed", prod_order_no: po,
  });
  const out: Document[] = [];
  if (d === "sales") {
    const pos = master(store, "production_orders");
    for (const l of master(store, "sales_lines")) {
      out.push(mk(l.so_number, "order", l.customer_id, l.fg_item_no, l.quantity, l.unit_price, l.order_date, pos.find((p) => p.so_number === l.so_number)?.po_number ?? null));
    }
    const inv: [string, string, string, number, number, string][] = [
      ["S-ORD100901", "C-01", "FG-1000", 10, 685, "2026-08-12"],
      ["S-ORD100902", "C-01", "FG-1000", 5, 640, "2026-09-10"],
      ["S-ORD100903", "C-02", "FG-2000", 12, 540, "2026-08-20"],
      ["S-ORD100904", "C-03", "FG-1000", 8, 700, "2026-09-15"],
      ["S-ORD100905", "C-04", "FG-3000", 1, 3200, "2026-07-30"],
      ["S-ORD100906", "C-05", "FG-6000", 1, 8700, "2026-09-02"],
      ["S-ORD100907", "C-07", "FG-3000", 2, 3300, "2026-09-25"],
      ["S-ORD100908", "C-06", "FG-2000", 4, 350, "2026-10-02"],
    ];
    for (const [n, c, i, q, p, dt] of inv) out.push(mk(n, "invoice", c, i, q, p, dt, null));
  } else {
    const comps = master(store, "components");
    for (const l of master(store, "vendor_po_lines")) {
      const c = comps.find((x) => x.item_no === l.component_item_no)!;
      out.push(mk(`${l.po_number}/${l.line_no}`, "order", l.vendor_id, l.component_item_no, l.quantity, c.unit_cost, l.need_date, null));
    }
    const inv: [string, string, string, number, number, string][] = [
      ["P-INV-9001", "V-100", "CMP-A", 20, 40.74, "2026-08-10"],
      ["P-INV-9002", "V-100", "CMP-A", 10, 47.5, "2026-09-12"],
      ["P-INV-9003", "V-200", "CMP-B", 50, 17.46, "2026-08-25"],
      ["P-INV-9004", "V-100", "CMP-C", 10, 9.2, "2026-09-18"],
      ["P-INV-9005", "V-300", "CMP-D", 30, 63, "2026-09-05"],
      ["P-INV-9006", "V-200", "CMP-E", 5, 150, "2026-10-01"],
    ];
    for (const [n, v, i, q, p, dt] of inv) out.push(mk(n, "invoice", v, i, q, p, dt, null));
  }
  return out;
}
