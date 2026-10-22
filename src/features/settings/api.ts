import { get, put } from "@/lib/api/request";

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

export const getSettings = () => get<AppSettings>("/api/settings");
export const putSettings = (s: AppSettings) => put<AppSettings>("/api/settings", s);
