import { appendAudit } from "@/server/audit";
import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";

// Application settings document (P: every field, default and limit is our design).

export interface AppSettings {
  companyName: string;
  currency: "USD" | "EUR" | "GBP";
  timezone: string;
  planningHorizonWeeks: number;
  defaultLeadTimeDays: number;
  autoRefreshSeconds: number;
  notificationEmail: string;
  showDemoBadge: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Acme Industries",
  currency: "USD",
  timezone: "UTC",
  planningHorizonWeeks: 26,
  defaultLeadTimeDays: 14,
  autoRefreshSeconds: 0,
  notificationEmail: "",
  showDemoBadge: true,
};

const KEY = "admin:settings";
const CURRENCIES = ["USD", "EUR", "GBP"];

export function getSettings(store: Store): AppSettings {
  return store.get(KEY, () => ({ ...DEFAULT_SETTINGS }));
}

function intIn(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${name} must be an integer between ${min} and ${max}`);
  return v;
}

/** Validate a partial document and return the fields to merge. Throws 400 on the first problem. */
export function validateSettings(body: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  for (const [k, v] of Object.entries(body)) {
    switch (k) {
      case "companyName":
        if (typeof v !== "string" || !v.trim() || v.trim().length > 80) throw badRequest("companyName must be 1 to 80 characters");
        out.companyName = v.trim();
        break;
      case "currency":
        if (typeof v !== "string" || !CURRENCIES.includes(v)) throw badRequest(`currency must be one of ${CURRENCIES.join(", ")}`);
        out.currency = v as AppSettings["currency"];
        break;
      case "timezone":
        if (typeof v !== "string" || !v.trim()) throw badRequest("timezone must be a non-empty string");
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: v.trim() });
        } catch {
          throw badRequest("timezone is not a valid IANA time zone");
        }
        out.timezone = v.trim();
        break;
      case "planningHorizonWeeks":
        out.planningHorizonWeeks = intIn(v, k, 1, 104);
        break;
      case "defaultLeadTimeDays":
        out.defaultLeadTimeDays = intIn(v, k, 0, 365);
        break;
      case "autoRefreshSeconds": {
        const n = intIn(v, k, 0, 3600);
        if (n !== 0 && n < 10) throw badRequest("autoRefreshSeconds must be 0 (off) or at least 10");
        out.autoRefreshSeconds = n;
        break;
      }
      case "notificationEmail":
        if (typeof v !== "string" || (v.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))) throw badRequest("notificationEmail must be empty or a valid email address");
        out.notificationEmail = v.trim();
        break;
      case "showDemoBadge":
        if (typeof v !== "boolean") throw badRequest("showDemoBadge must be true or false");
        out.showDemoBadge = v;
        break;
      default:
        throw badRequest(`Unknown setting: ${k}`);
    }
  }
  return out;
}

export function saveSettings(store: Store, actor: string, body: Record<string, unknown>): AppSettings {
  const patch = validateSettings(body);
  const before = getSettings(store);
  const changed = (Object.keys(patch) as (keyof AppSettings)[]).filter((k) => before[k] !== patch[k]);
  const next = { ...before, ...patch };
  store.set(KEY, next);
  appendAudit(store, { source: "admin", actor, action: "settings.update", detail: changed.length ? `changed: ${changed.join(", ")}` : "no changes" });
  return next;
}
