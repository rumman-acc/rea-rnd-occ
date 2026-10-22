import { master } from "../../master";
import type { Store } from "../../store";
import type { Bin, LegacyPo, StockRow, WhSettings } from "./types";

export const LOCATION = "MAIN";
export const LOT_TRACKED = new Set(["CMP-C", "CMP-E"]);
export const DEFAULT_BIN: Record<string, string> = { "CMP-A": "A-01", "CMP-B": "B-01", "CMP-C": "A-02", "CMP-D": "BLK-01", "CMP-E": "B-02", "CMP-F": "A-03" };
export const FALLBACK_BIN = "RCV-01";

export const KEYS = {
  bins: "warehouse:bins",
  stock: "warehouse:stock",
  settings: "warehouse:settings",
  lines: "warehouse:lines",
  poDates: "warehouse:po_dates",
  history: "warehouse:history",
  legacy: "warehouse:legacy_pos",
} as const;

export const seedBins = (): Bin[] => [
  { code: "RCV-01", zone: "RECEIVING" },
  { code: "RCV-02", zone: "RECEIVING" },
  { code: "A-01", zone: "RACK-A" },
  { code: "A-02", zone: "RACK-A" },
  { code: "A-03", zone: "RACK-A" },
  { code: "B-01", zone: "RACK-B" },
  { code: "B-02", zone: "RACK-B" },
  { code: "BLK-01", zone: "BULK" },
];

export const seedSettings = (): WhSettings => ({
  over_delivery_tolerance_pct: 5,
  printer: { label_printer: "", document_printer: "" },
  scanner: { mode: "keyboard-wedge" },
  barcode: { symbology: "code128" },
});

export const seedLegacy = (): LegacyPo[] => [
  { po_number: "V-PO-4990", vendor_id: "V-200", last_receipt_date: "2026-10-02", lines: [{ item_no: "CMP-B", ordered: 40, received: 40 }] },
];

/** Stock split derived from component on_hand: ~60% in the default bin, rest in RCV-01. */
export function seedStock(store: Store): StockRow[] {
  const rows: StockRow[] = [];
  for (const c of master(store, "components")) {
    if (c.on_hand <= 0) continue;
    const main = Math.round(c.on_hand * 0.6);
    const rest = c.on_hand - main;
    const sfx = c.item_no.slice(-1);
    const lot = (n: number) => (LOT_TRACKED.has(c.item_no) ? `LOT-${sfx}-260${n}` : "");
    if (main > 0) rows.push({ item_no: c.item_no, bin: DEFAULT_BIN[c.item_no] ?? FALLBACK_BIN, lot: lot(1), qty: main });
    if (rest > 0) rows.push({ item_no: c.item_no, bin: FALLBACK_BIN, lot: lot(2), qty: rest });
  }
  return rows;
}
