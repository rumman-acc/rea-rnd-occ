import { appendAudit } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import { master } from "@/server/master";
import type { Store } from "@/server/store";
import { round1, round2 } from "./dates";
import { costSettings, isObj, KEYS, requireNum, routing, seedWorkCenters, workCenters } from "./data";

/** CST-BR-001..003 */
export function costing(store: Store) {
  const { overhead_pct } = costSettings(store);
  const comps = master(store, "components");
  const bom = master(store, "bom");
  const sales = master(store, "sales_lines");
  const wcs = workCenters(store);
  const models = routing(store);
  const items = master(store, "fg_items").map((fg) => {
    const components = bom
      .filter((b) => b.fg_item_no === fg.item_no)
      .map((b) => {
        const c = comps.find((x) => x.item_no === b.component_item_no);
        const unit_cost = c?.unit_cost ?? 0;
        return { item_no: b.component_item_no, description: c?.description ?? "", qty_per: b.qty_per, unit_cost, extended: round2(b.qty_per * unit_cost) };
      });
    const operations = Object.entries(models[fg.item_no] ?? {}).map(([code, hours]) => {
      const wc = wcs.find((w) => w.code === code);
      const rate = wc?.labor_rate ?? 0;
      return { work_center: code, name: wc?.name ?? code, hours, rate, extended: round2(hours * rate) };
    });
    const material = round2(components.reduce((s, c) => s + c.qty_per * c.unit_cost, 0));
    const labor = round2(operations.reduce((s, o) => s + o.hours * o.rate, 0));
    const overhead = round2((labor * overhead_pct) / 100);
    const total = round2(material + labor + overhead);
    let last: (typeof sales)[number] | null = null;
    for (const l of sales) if (l.fg_item_no === fg.item_no && (!last || l.order_date >= last.order_date)) last = l;
    const price = last ? last.unit_price : null;
    return {
      item_no: fg.item_no,
      description: fg.description,
      series: fg.series,
      material_cost: material,
      labor_cost: labor,
      overhead_cost: overhead,
      total_cost: total,
      sales_price: price,
      margin: price === null ? null : round2(price - total),
      margin_pct: price === null || price === 0 ? null : round1(((price - total) / price) * 100),
      components,
      operations,
    };
  });
  return { overhead_pct, items };
}

export function putLaborRates(store: Store, actor: string, body: Record<string, unknown>) {
  const codes = new Set(workCenters(store).map((w) => w.code));
  const rates = body.rates ?? {};
  if (!isObj(rates)) throw badRequest("rates must be an object");
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates)) {
    if (!codes.has(k)) throw notFound(`work center ${k} not found`);
    next[k] = requireNum(v, `rates.${k}`, 0, 10000);
  }
  const oh = body.overhead_pct === undefined ? undefined : requireNum(body.overhead_pct, "overhead_pct", 0, 500);
  if (Object.keys(next).length === 0 && oh === undefined) throw badRequest("rates or overhead_pct is required");
  store.update(KEYS.workcenters, seedWorkCenters, (d) => void d.forEach((w) => next[w.code] !== undefined && (w.labor_rate = next[w.code])));
  if (oh !== undefined) store.update(KEYS.cost, () => ({ overhead_pct: 12 }), (d) => void (d.overhead_pct = oh));
  appendAudit(store, {
    source: "production",
    actor,
    action: "rates.update",
    detail: [...Object.entries(next).map(([k, v]) => `${k}=${v}`), ...(oh !== undefined ? [`overhead=${oh}%`] : [])].join(", "),
  });
  return { work_centers: workCenters(store), overhead_pct: costSettings(store).overhead_pct };
}
