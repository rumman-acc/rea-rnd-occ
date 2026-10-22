import { formatMoney, formatShortDate, formatUnits } from "./format";
import type { StatusRow } from "./types";

// At-Risk Sales Orders table logic (SPEC §2.7).
// Sorting uses RAW values, preserved from the original (TBL-022).
// Filtering uses DISPLAYED text, an intentional deviation from the original's
// raw-value matching (TBL-023, TBL-024; decision D4).

export type ColumnId = "so" | "cust" | "series" | "del" | "qty" | "val" | "status";

export interface Column {
  id: ColumnId;
  label: string;
  numeric: boolean;
  /** Raw value used for sorting. */
  raw: (row: StatusRow) => string | number;
  /** Text exactly as displayed in the cell; used for filtering. */
  text: (row: StatusRow) => string;
}

export const rowValue = (r: StatusRow): number => r.quantity * r.unit_price;

export const statusLabel = (r: StatusRow): string => (r.health === "red" ? "At Risk" : "Watch");

export const COLUMNS: readonly Column[] = [
  { id: "so", label: "SO #", numeric: false, raw: (r) => r.so_number, text: (r) => r.so_number },
  {
    id: "cust",
    label: "Customer",
    numeric: false,
    raw: (r) => r.customer_name ?? "",
    text: (r) => r.customer_name || "—",
  },
  { id: "series", label: "Series", numeric: false, raw: (r) => r.series ?? "", text: (r) => r.series ?? "" },
  {
    id: "del",
    label: "Delivery",
    numeric: false,
    raw: (r) => r.delivery_date ?? "",
    text: (r) => formatShortDate(r.delivery_date),
  },
  { id: "qty", label: "Qty", numeric: true, raw: (r) => r.quantity, text: (r) => formatUnits(r.quantity) },
  { id: "val", label: "Value", numeric: true, raw: rowValue, text: (r) => formatMoney(rowValue(r)) },
  { id: "status", label: "Status", numeric: false, raw: (r) => r.health, text: statusLabel },
];

export interface SortState {
  id: ColumnId;
  dir: 1 | -1;
}

export type Filters = Partial<Record<ColumnId, string>>;

/** none → ascending → descending → none; another column starts ascending (TBL-021). */
export function nextSort(current: SortState | null, id: ColumnId): SortState | null {
  if (current?.id === id) return current.dir === 1 ? { id, dir: -1 } : null;
  return { id, dir: 1 };
}

export function applyFilters(rows: readonly StatusRow[], filters: Filters): StatusRow[] {
  let out = [...rows];
  for (const col of COLUMNS) {
    const needle = (filters[col.id] ?? "").trim().toLowerCase();
    if (needle) out = out.filter((r) => col.text(r).toLowerCase().includes(needle));
  }
  return out;
}

export function applySort(rows: readonly StatusRow[], sort: SortState | null): StatusRow[] {
  if (!sort) return [...rows];
  const col = COLUMNS.find((c) => c.id === sort.id)!;
  return [...rows].sort((a, b) =>
    col.numeric
      ? ((Number(col.raw(a)) || 0) - (Number(col.raw(b)) || 0)) * sort.dir
      : String(col.raw(a)).localeCompare(String(col.raw(b))) * sort.dir,
  );
}

/** Filter, then sort (SPEC TBL-023). */
export function viewRows(rows: readonly StatusRow[], filters: Filters, sort: SortState | null): StatusRow[] {
  return applySort(applyFilters(rows, filters), sort);
}
