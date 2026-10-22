import type { Store } from "../store";
import { seedMaster } from "./seed";
import type { MasterData } from "./types";

export * from "./types";

// Master data lives under the "master:" prefix, one document per collection.
// Modules read it through these accessors and write it with `store.update(key, seed, fn)`.

export const MASTER_KEYS = {
  customers: "master:customers",
  vendors: "master:vendors",
  fg_items: "master:fg_items",
  sales_lines: "master:sales_lines",
  production_orders: "master:production_orders",
  components: "master:components",
  bom: "master:bom",
  vendor_po_lines: "master:vendor_po_lines",
} as const;

type Name = keyof MasterData;

export function seedFor<K extends Name>(name: K): () => MasterData[K] {
  return () => seedMaster()[name];
}

export function master<K extends Name>(store: Store, name: K): MasterData[K] {
  return store.get(MASTER_KEYS[name], seedFor(name));
}

export function updateMaster<K extends Name, R = void>(store: Store, name: K, fn: (draft: MasterData[K]) => R): R {
  return store.update(MASTER_KEYS[name], seedFor(name), fn);
}

export interface ComponentBalance {
  item_no: string;
  required: number;
  on_hand: number;
  incoming: number;
  /** on_hand + incoming - required */
  balance: number;
  short: boolean;
}

/**
 * Netting per component: requirement from all open sales lines through the BOM, against
 * on-hand stock plus open vendor PO quantity. This is our own simple rule (SPEC-FULL D6).
 */
export function componentBalances(store: Store): ComponentBalance[] {
  const lines = master(store, "sales_lines");
  const bom = master(store, "bom");
  const comps = master(store, "components");
  const pos = master(store, "vendor_po_lines").filter((l) => l.status === "Open");

  const required = new Map<string, number>();
  for (const l of lines) {
    for (const b of bom.filter((x) => x.fg_item_no === l.fg_item_no)) {
      required.set(b.component_item_no, (required.get(b.component_item_no) ?? 0) + l.quantity * b.qty_per);
    }
  }
  return comps.map((c) => {
    const req = required.get(c.item_no) ?? 0;
    const incoming = pos.filter((p) => p.component_item_no === c.item_no).reduce((s, p) => s + p.quantity, 0);
    const balance = c.on_hand + incoming - req;
    return { item_no: c.item_no, required: req, on_hand: c.on_hand, incoming, balance, short: balance < 0 };
  });
}
