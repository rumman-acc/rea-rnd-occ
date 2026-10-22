import { appendAudit } from "@/server/audit";
import { nowIso } from "@/server/clock";
import type { Store } from "@/server/store";

// Simulated connectors and peer instance (P). No network access of any kind.

export interface Integration {
  id: string;
  name: string;
  kind: string;
  status: "simulated";
  detail: string;
}

export const integrations = (): Integration[] => [
  { id: "business-central", name: "Business Central", kind: "ERP", status: "simulated", detail: "Local simulated connector; no ERP is contacted." },
  { id: "pricing-app", name: "External pricing app", kind: "Pricing", status: "simulated", detail: "Local simulated connector; prices come from demo data." },
  { id: "mail", name: "Mail", kind: "Email", status: "simulated", detail: "Local simulated connector; no email is sent." },
];

export interface Peer {
  id: string;
  status: "simulated";
  url: string;
  startedAt: string;
  note: string;
}

const KEY = "admin:peers";

export function startPeer(store: Store, actor: string): Peer {
  const n = store.get<Peer[]>(KEY, () => []).length + 1;
  const peer: Peer = {
    id: `peer-${n}`,
    status: "simulated",
    url: `http://peer-${n}.invalid`,
    startedAt: nowIso(),
    note: "Simulated: no process was started.",
  };
  store.update<Peer[]>(KEY, () => [], (l) => void l.push(peer));
  appendAudit(store, { source: "admin", actor, action: "peer.start", detail: `${peer.id} (simulated)` });
  return peer;
}
