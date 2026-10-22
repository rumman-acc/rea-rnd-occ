import { appendAudit } from "@/server/audit";
import { nowIso } from "@/server/clock";
import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";
import { APP_VERSION } from "@/server/version";

// Releases and the SIMULATED upgrade (P). Nothing here changes code or APP_VERSION.

export interface Release {
  version: string;
  date: string;
  notes: string;
  status: "current" | "available" | "previous";
}

const CATALOG: Omit<Release, "status">[] = [
  { version: "1.48.0", date: "2026-11-02", notes: "Demo release: planning workbench refinements." },
  { version: "1.47.0", date: "2026-09-28", notes: "Demo release: admin center, settings and releases pages." },
  { version: "1.46.0", date: "2026-08-24", notes: "Demo release: purchasing cockpit updates." },
  { version: "1.45.0", date: "2026-07-20", notes: "Demo release: supply explorer filters." },
];

const cmp = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

export function releaseList(): Release[] {
  return CATALOG.map((r) => ({ ...r, status: r.version === APP_VERSION ? "current" : cmp(r.version, APP_VERSION) > 0 ? "available" : "previous" }) as Release);
}

export const UPGRADE_STEPS = ["Queued", "Downloading package", "Verifying checksum", "Applying (simulated)", "Restarting (simulated)", "Completed"];

export interface UpgradeRecord {
  id: string;
  version: string;
  from: string;
  operator: string;
  requestedAt: string;
  simulated: true;
  status: "completed";
  steps: { name: string; status: "done" }[];
  note: string;
}

const KEY = "admin:upgrades";

export const listUpgrades = (store: Store): UpgradeRecord[] => store.get<UpgradeRecord[]>(KEY, () => []).slice().reverse();

export function startUpgrade(store: Store, actor: string, body: { version?: unknown; operator?: unknown }): UpgradeRecord {
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version) throw badRequest("version is required");
  const rel = releaseList().find((r) => r.version === version);
  if (!rel) throw badRequest(`Unknown release ${version}`);
  if (rel.status === "current") throw badRequest(`Version ${version} is already the running version`);
  const operator = typeof body.operator === "string" && body.operator.trim() ? body.operator.trim() : actor;
  const all = store.get<UpgradeRecord[]>(KEY, () => []);
  const rec: UpgradeRecord = {
    id: `upg-${String(all.length + 1).padStart(4, "0")}`,
    version,
    from: APP_VERSION,
    operator,
    requestedAt: nowIso(),
    simulated: true,
    status: "completed",
    steps: UPGRADE_STEPS.map((name) => ({ name, status: "done" as const })),
    note: "Simulation only: no code was changed and the running version is unchanged.",
  };
  store.update<UpgradeRecord[]>(KEY, () => [], (l) => void l.push(rec));
  appendAudit(store, { source: "admin", actor: operator, action: "upgrade.simulate", detail: `${APP_VERSION} -> ${version} (${rec.id}, simulated)` });
  return rec;
}
