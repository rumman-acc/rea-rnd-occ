import { appendAudit } from "@/server/audit";
import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";

// Finance settings (GET/PUT /api/finops/settings). The keys are our own design (spec/finance.md).

export interface FinanceSettings {
  customer_terms_days: number;
  vendor_terms_days: number;
  /** Cash posted by the opening entry of the simulated ledger (applies on a full sync). */
  opening_cash: number;
}

const KEY = "finops:settings";
const seed = (): FinanceSettings => ({ customer_terms_days: 30, vendor_terms_days: 30, opening_cash: 250000 });

export function getSettings(store: Store): FinanceSettings {
  return store.get(KEY, seed);
}

const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function saveSettings(store: Store, values: unknown, actor: string): FinanceSettings {
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw badRequest("values must be an object");
  const next = getSettings(store);
  for (const [k, v] of Object.entries(values)) {
    if (k === "customer_terms_days" || k === "vendor_terms_days") {
      if (!isInt(v, 0, 180)) throw badRequest(`${k} must be an integer from 0 to 180`);
      next[k] = v as number;
    } else if (k === "opening_cash") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw badRequest("opening_cash must be a number of 0 or more");
      next.opening_cash = v;
    } else {
      throw badRequest(`Unknown setting: ${k}`);
    }
  }
  store.set(KEY, next);
  appendAudit(store, { source: "finance", actor, action: "settings.update", detail: JSON.stringify(values) });
  return next;
}
