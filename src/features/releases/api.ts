import { get, post } from "@/lib/api/request";

export interface Release { version: string; date: string; notes: string; status: "current" | "available" | "previous" }
export interface Upgrade {
  id: string;
  version: string;
  from: string;
  operator: string;
  requestedAt: string;
  simulated: boolean;
  status: string;
  steps: { name: string; status: string }[];
  note: string;
}
export interface Releases { current: string; releases: Release[]; upgrades: Upgrade[]; simulated: boolean }

export const getReleases = () => get<Releases>("/api/admin/releases");
export const startUpgrade = (version: string, operator: string) => post<Upgrade>("/api/admin/upgrade", { version, operator });
