import { componentBalances, master, updateMaster } from "@/server/master";
import type { Store } from "@/server/store";
import { nextId } from "./core";
import { overdueByVendor } from "./proposals";
import type { InboxItem } from "./types";

type R = Record<string, unknown>;
const payload = (item: { context_data: R }) => (item.context_data.payload ?? {}) as Record<string, string | number>;

/** Execute an approved action. Errors are returned in the result (HTTP stays 200), as the page expects. */
export function executeItem(store: Store, item: Pick<InboxItem, "action_type" | "context_data">): R {
  const p = payload(item);
  switch (item.action_type) {
    case "CREATE_PO": {
      const comp = master(store, "components").find((c) => c.item_no === p.item_no);
      if (!comp) return { error: `Unknown component ${String(p.item_no)}` };
      const po = nextId(store, "po", "AI-PO-");
      updateMaster(store, "vendor_po_lines", (d) => {
        d.push({
          po_number: po,
          line_no: "1",
          vendor_id: String(p.vendor_id),
          component_item_no: comp.item_no,
          quantity: Number(p.quantity),
          need_date: String(p.need_date),
          receipt_date: String(p.receipt_date),
          status: "Open",
        });
      });
      return { bc_po_number: po, po_number: po, vendor: String(p.vendor_id), amount: Number(p.quantity) * comp.unit_cost, delivery_date: p.receipt_date, local: true };
    }
    case "RESCHEDULE_PROD_ORDER":
      return master(store, "production_orders").some((o) => o.po_number === p.po_number)
        ? { applied: "app_simulation" }
        : { error: `Production order ${String(p.po_number)} not found` };
    case "CHANGE_SO_DATE":
      return { applied: "journal_only" };
    case "EMAIL_SUPPLIER":
      return { delivery: "manual" };
    default:
      return { error: `Action ${item.action_type} cannot be executed` };
  }
}

export interface Verdict {
  verdict: "still_valid" | "changed" | "obsolete";
  summary: string;
  checked_at: string;
}

/** Re-read master data and judge whether a saved proposal still holds (REQ-AI-AGT-008). */
export function revalidate(store: Store, item: InboxItem): Omit<Verdict, "checked_at"> {
  const p = payload(item);
  switch (item.action_type) {
    case "CREATE_PO": {
      const b = componentBalances(store).find((x) => x.item_no === p.item_no);
      if (!b || !b.short) return { verdict: "obsolete", summary: `${String(p.item_no)} is no longer projected short.` };
      const sizing = item.context_data.risk_sizing as { net_need: number };
      return -b.balance !== sizing.net_need
        ? { verdict: "changed", summary: `Shortage is now ${-b.balance}, was ${sizing.net_need}. Review quantity.` }
        : { verdict: "still_valid", summary: `${String(p.item_no)} is still short by ${-b.balance}.` };
    }
    case "RESCHEDULE_PROD_ORDER": {
      const po = master(store, "production_orders").find((o) => o.po_number === p.po_number);
      const before = (item.context_data.simulation as { before: { start: string; end: string } }).before;
      const line = po && master(store, "sales_lines").find((l) => l.so_number === po.so_number);
      if (!po || !line) return { verdict: "obsolete", summary: `${String(p.po_number)} no longer exists or has no sales order.` };
      if (po.end_date <= line.delivery_date) return { verdict: "obsolete", summary: `${po.po_number} no longer ends after the promise date.` };
      return po.start_date !== before.start || po.end_date !== before.end
        ? { verdict: "changed", summary: `${po.po_number} dates moved to ${po.start_date} → ${po.end_date}.` }
        : { verdict: "still_valid", summary: `${po.po_number} is still late.` };
    }
    case "CHANGE_SO_DATE": {
      const l = master(store, "sales_lines").find((x) => x.so_number === p.so_number && x.line_no === p.line_no);
      if (!l) return { verdict: "obsolete", summary: "The sales line no longer exists." };
      if (master(store, "production_orders").some((o) => o.so_number === l.so_number)) return { verdict: "obsolete", summary: "A production order is now linked." };
      return { verdict: "still_valid", summary: "The line still has no production order." };
    }
    case "EMAIL_SUPPLIER": {
      const listed = (item.context_data.overdue_lines as { po_number: string; line_no: string }[]) ?? [];
      const now = overdueByVendor(store).get(String(item.context_data.vendor_id)) ?? [];
      const still = listed.filter((l) => now.some((n) => n.po_number === l.po_number && n.line_no === l.line_no));
      if (!still.length) return { verdict: "obsolete", summary: "None of the listed lines is overdue any more." };
      return still.length < listed.length
        ? { verdict: "changed", summary: `${still.length} of ${listed.length} lines are still overdue.` }
        : { verdict: "still_valid", summary: `All ${listed.length} lines are still overdue.` };
    }
    default:
      return { verdict: "obsolete", summary: "Not a savable action." };
  }
}
