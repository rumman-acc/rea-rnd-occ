import { get, post } from "@/lib/api/request";
import type { BuyRecommendation, FgEntry, Health, Netting, PushResult, SupplyDetail } from "./types";

export const getSupplyDetail = (fg: string) => get<SupplyDetail>(`/api/supply-detail/${encodeURIComponent(fg)}`);
export const getSupplyStatuses = () => get<Record<string, Health>>("/api/supply-status");
export const getFgCatalog = () => get<FgEntry[]>("/api/fgs");
export const getSupplyNetting = () => get<Netting>("/api/supply-netting");
export const getBuyRecommendation = (item: string, horizon: string) =>
  get<BuyRecommendation>(`/api/buy-recommendation/${encodeURIComponent(item)}?horizon=${horizon}`);
export const pushPurchaseOrder = (
  vendor_no: string,
  lines: { item_no: string; quantity: number; required_date: string; unit_price?: number }[],
  operator = "",
) => post<PushResult>("/api/replenishment/push", { vendor_no, lines, operator });
