import { get, put } from "@/lib/api/request";

export interface SopCell {
  month: string;
  demand: number;
  scheduled: number;
  firm: number;
  flex: number;
  effective_supply: number;
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
  items?: SopItem[];
  available_items?: { item_no: string; description: string }[];
}

export interface SopData {
  months: string[];
  rows: SopRow[];
  insights: string[];
}

/** Keys are "<model>_<YYYY-MM>" or "<model>|<item>_<YYYY-MM>"; null clears an entry. */
export type PlanEdits = Record<string, { firm?: number; flex?: number } | null>;

export const getSop = () => get<SopData>("/api/sop");
export const putSopPlan = (entries: PlanEdits) => put<{ saved: number }>("/api/sop/plan", { entries });
