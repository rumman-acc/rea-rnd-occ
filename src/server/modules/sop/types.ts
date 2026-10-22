// S&OP response shapes. Field names are read from the page chunk; the rest is our design (P).

export interface SopCell {
  /** YYYY-MM */
  month: string;
  demand: number;
  scheduled: number;
  firm: number;
  flex: number;
  /** scheduled + firm + flex */
  effective_supply: number;
  /** effective_supply - demand */
  gap: number;
}

export interface SopItem {
  item_no: string;
  description: string;
  cells: SopCell[];
}

export interface SopRow {
  series: string;
  model: string;
  cells: SopCell[];
  items: SopItem[];
  available_items: { item_no: string; description: string }[];
}

export interface SopResponse {
  months: string[];
  rows: SopRow[];
  insights: string[];
}

export interface PlanEntry {
  firm: number;
  flex: number;
}

/** Value sent per key in PUT /api/sop/plan: a partial update, or null to clear. */
export type EntryPatch = { firm?: number; flex?: number } | null;
