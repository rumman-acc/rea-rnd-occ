import type { BomRow, Projection } from "./types";

export interface NettingRow {
  kind: "sub" | "leaf";
  item_no: string;
  description: string;
  level: number;
  required: number;
  opening: number;
  minBalance: number;
  netEnd: number;
  stockout: string | null;
}

/** Netting rows for one order (REQ-SUP-BEH-003): leaves repeated in the BOM accumulate into their first row. */
export function nettingRows(bom: BomRow[], quantity: number, proj: Record<string, Projection>): NettingRow[] {
  const rows: NettingRow[] = [];
  const index = new Map<string, number>();
  for (const b of bom) {
    const required = b.extended_qty * quantity;
    if (b.is_subassembly) {
      rows.push({ kind: "sub", item_no: b.item_no, description: b.description, level: b.level, required, opening: 0, minBalance: 0, netEnd: 0, stockout: null });
      continue;
    }
    const at = index.get(b.item_no);
    if (at !== undefined) {
      rows[at].required += required;
      continue;
    }
    const p = proj[b.item_no];
    index.set(b.item_no, rows.length);
    rows.push({
      kind: "leaf", item_no: b.item_no, description: b.description, level: b.level, required,
      opening: p?.opening_inventory ?? 0,
      minBalance: p?.min_balance ?? 0,
      netEnd: p?.events.length ? p.events[p.events.length - 1].balance_after : (p?.opening_inventory ?? 0),
      stockout: p?.first_stockout_date ?? null,
    });
  }
  return rows;
}

export const netStatus = (r: NettingRow): string => (r.kind === "sub" ? "manufactured" : r.stockout ? "shortfall" : "sufficient");

export function supplyCsv(so: string, rows: NettingRow[]): string[] {
  return [
    "SO,Component,Description,Level,SubAssembly,Required,OpeningInv,MinBalance,NetAvailable,FirstStockout,Status",
    ...rows.map((r) =>
      [so, r.item_no, `"${r.description}"`, r.level, r.kind === "sub" ? "yes" : "no", r.required, r.opening, r.minBalance, r.netEnd, r.stockout ?? "", netStatus(r)].join(","),
    ),
  ];
}
