"use client";

import { BarController, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import { Check, ChevronDown, ChevronRight, Download, LoaderCircle, Plus, RotateCcw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar } from "react-chartjs-2";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { formatUnits } from "@/domain/format";
import { getSop, putSopPlan, type PlanEdits, type SopCell, type SopData, type SopItem, type SopRow } from "./api";
import "./sop.css";

ChartJS.register(BarElement, BarController, CategoryScale, LinearScale, Tooltip, Legend);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10" -> "Oct 26" */
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const sumOf = (cells: SopCell[], f: keyof Omit<SopCell, "month">) => cells.reduce((s, c) => s + c[f], 0);
const hasData = (cells: SopCell[]) => cells.some((c) => c.demand || c.scheduled || c.firm || c.flex);
const gapClass = (n: number) => (n > 0 ? "sop-pos" : n < 0 ? "sop-neg" : "sop-zero");
const blankCells = (months: string[]): SopCell[] =>
  months.map((month) => ({ month, demand: 0, scheduled: 0, firm: 0, flex: 0, effective_supply: 0, gap: 0 }));

export function buildCsv(data: SopData): string[] {
  const lines = ["Model,Series,Month,Demand,Scheduled,FirmPlan,FlexPlan,Gap"];
  for (const r of data.rows) {
    for (const c of r.cells) lines.push([`"${r.model}"`, r.series, c.month, c.demand, c.scheduled, c.firm, c.flex, c.gap].join(","));
  }
  return lines;
}

function downloadCsv(name: string, lines: string[]) {
  const a = document.createElement("a");
  a.href = "data:text/csv," + encodeURIComponent(lines.join("\n"));
  a.download = name;
  a.click();
}

type Edit = (key: string, month: string, layer: "firm" | "flex", value: string) => void;

export function Sop() {
  const [data, setData] = useState<SopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<PlanEdits>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [extra, setExtra] = useState<Record<string, string[]>>({});
  const [hidden, setHidden] = useState<Record<string, string[]>>({});

  // Per-viewer convenience: which finished goods are shown in each model's item sheet.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sop.sheetRows");
      if (!raw) return;
      const v = JSON.parse(raw) as { extra?: Record<string, string[]>; hidden?: Record<string, string[]> };
      setExtra(v.extra ?? {});
      setHidden(v.hidden ?? {});
    } catch {
      // storage unavailable or corrupt: start empty
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("sop.sheetRows", JSON.stringify({ extra, hidden }));
    } catch {
      // ignore
    }
  }, [extra, hidden]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getSop());
      pending.current = {};
      setPendingCount(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const onEdit: Edit = (key, month, layer, value) => {
    const k = `${key}_${month}`;
    pending.current[k] = { ...(pending.current[k] ?? {}), [layer]: value === "" ? 0 : Number(value) };
    setPendingCount(Object.keys(pending.current).length);
  };

  async function save() {
    if (!pendingCount) return;
    setSaving(true);
    setSaveError(null);
    try {
      await putSopPlan(pending.current);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!data || !window.confirm("Clear ALL firm and flex plan overrides across every series?")) return;
    const clear: PlanEdits = {};
    for (const r of data.rows) {
      for (const c of r.cells) if (c.firm !== 0 || c.flex !== 0) clear[`${r.model}_${c.month}`] = null;
      for (const it of r.items ?? []) {
        for (const c of it.cells) if (c.firm !== 0 || c.flex !== 0) clear[`${r.model}|${it.item_no}_${c.month}`] = null;
      }
    }
    setSaveError(null);
    try {
      await putSopPlan(clear);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  function addModel() {
    if (!data) return;
    const name = window.prompt("New model (e.g. 5000 1H). A plan-only row is added; save a Firm/Flex quantity to persist it:");
    if (!name?.trim()) return;
    const model = name.trim().toUpperCase();
    if (data.rows.some((r) => r.model === model)) return;
    const digit = /^\D*(\d)/.exec(model)?.[1];
    const row: SopRow = { series: digit ? `${digit}000` : "", model, cells: blankCells(data.months), items: [], available_items: [] };
    const rows = [...data.rows, row].sort(
      (a, b) => (a.series || "~").localeCompare(b.series || "~") || a.model.localeCompare(b.model),
    );
    setData({ ...data, rows });
  }

  if (loading && !data) {
    return (
      <div className="loading" role="status">
        <LoaderCircle className="spin" size={18} /> Building S&amp;OP plan…
      </div>
    );
  }
  if (error) return <p className="notice notice--bad" role="alert">{error}</p>;
  if (!data) return null;

  const seriesList = [...new Set(data.rows.map((r) => r.series).filter(Boolean))];
  const shown = series ? data.rows.filter((r) => r.series === series) : data.rows;
  const demandByMonth = data.months.map((_, i) => data.rows.reduce((s, r) => s + r.cells[i].demand, 0));
  const supplyByMonth = data.months.map((_, i) => data.rows.reduce((s, r) => s + r.cells[i].effective_supply, 0));

  return (
    <div>
      <PageHeader
        title="S&OP Planning"
        sub="Rolling 6-month demand and production plan — demand from sales orders, scheduled supply from production orders (demo data)"
        actions={
          <>
            {saved && <span className="pill pill--green">Plan saved</span>}
            <button className="btn" onClick={() => downloadCsv(`sop-plan-${data.months[0]}.csv`, buildCsv(data))}>
              <Download size={13} /> Export CSV
            </button>
            <button className="btn" onClick={addModel}>
              <Plus size={13} /> Add Model
            </button>
            <button className="btn" onClick={reset}>
              <RotateCcw size={13} /> Reset
            </button>
            <button className="btn btn--primary" onClick={save} disabled={!pendingCount || saving}>
              {saving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
              Save Plan{pendingCount ? ` (${pendingCount})` : ""}
            </button>
          </>
        }
      />
      {saveError && (
        <p className="notice notice--bad sop-demo" role="alert">
          {saveError}
        </p>
      )}

      <div className="sop-filter">
        <span className="sop-filter__label">Series filter:</span>
        <Chip label="All" active={!series} onClick={() => setSeries("")} />
        {seriesList.map((s) => (
          <Chip key={s} label={s} active={series === s} onClick={() => setSeries(s)} />
        ))}
        <span className="sop-filter__hint">
          planning grain: routing model ({shown.length} row{shown.length === 1 ? "" : "s"})
        </span>
      </div>

      <div className="sop-demo">
        <Card
          title="Demand & Production Plan"
          bodyClassName="sop-scroll"
          actions={
            <span className="sop-legend">
              <span>
                <span className="sop-legend__swatch" />
                Demand
              </span>
              <span style={{ color: "var(--warn)" }}>✎ Click plan cells to edit</span>
              <span className="sop-pos">▲ Surplus</span>
              <span className="sop-neg">▼ Gap</span>
            </span>
          }
        >
          <table className="sop-table" style={{ margin: -16, width: "calc(100% + 32px)" }}>
            <thead>
              <tr>
                <th>Series / Row</th>
                {data.months.map((m) => (
                  <th key={m}>{monthLabel(m)}</th>
                ))}
                <th className="sop-total">6M Total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <ModelBlock
                  key={r.model}
                  row={r}
                  months={data.months}
                  onEdit={onEdit}
                  expanded={!!expanded[r.model]}
                  onToggle={() => setExpanded((e) => ({ ...e, [r.model]: !e[r.model] }))}
                  extraItems={extra[r.model] ?? []}
                  hiddenItems={hidden[r.model] ?? []}
                  onToggleItem={(item, on) => {
                    setExtra((x) => {
                      const cur = x[r.model] ?? [];
                      return { ...x, [r.model]: on ? [...cur.filter((i) => i !== item), item] : cur.filter((i) => i !== item) };
                    });
                    setHidden((h) => {
                      const cur = h[r.model] ?? [];
                      return { ...h, [r.model]: on ? cur.filter((i) => i !== item) : [...cur.filter((i) => i !== item), item] };
                    });
                  }}
                />
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={data.months.length + 2}>No models.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid-2 sop-demo">
        <Card title="Total Demand vs Plan by Month (units)">
          <div
            className="sop-chart"
            role="img"
            aria-label={
              "Demand vs plan by month: " + data.months.map((m, i) => `${monthLabel(m)} ${demandByMonth[i]} vs ${supplyByMonth[i]}`).join(", ")
            }
          >
            <Bar
              data={{
                labels: data.months.map(monthLabel),
                datasets: [
                  { label: "Demand", data: demandByMonth, backgroundColor: "rgba(220,38,38,.7)", borderRadius: 4 },
                  { label: "Plan (scheduled+firm+flex)", data: supplyByMonth, backgroundColor: "rgba(27,74,120,.85)", borderRadius: 4 },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "top" } },
                scales: { y: { beginAtZero: true } },
              }}
            />
          </div>
        </Card>
        <div className="sop-intel">
          <div className="sop-intel__title">
            <span aria-hidden>✦</span>
            <h2 style={{ margin: 0, fontSize: "inherit" }}>S&amp;OP Intelligence</h2>
          </div>
          {data.insights.map((t, i) => (
            <div key={i} className="sop-intel__line">
              {t.includes("shortfall") ? "⚠ " : t.includes("surplus") ? "📦 " : "✓ "}
              {t}
            </div>
          ))}
          <div className="sop-intel__foot">
            Rule-based observations over the sheet above (not a forecast model). Firm = committed production plan · Flex =
            upside/option volume. Both are saved on the server and close gaps in this analysis; no production orders are
            created from here.
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? "sop-chip sop-chip--active" : "sop-chip"} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}

function ModelBlock({
  row,
  months,
  onEdit,
  expanded,
  onToggle,
  extraItems,
  hiddenItems,
  onToggleItem,
}: {
  row: SopRow;
  months: string[];
  onEdit: Edit;
  expanded: boolean;
  onToggle: () => void;
  extraItems: string[];
  hiddenItems: string[];
  onToggleItem: (item: string, on: boolean) => void;
}) {
  const items = row.items ?? [];
  const available = row.available_items ?? [];
  const span = row.cells.length + 2;
  const visible: SopItem[] = [
    ...items.filter((i) => hasData(i.cells) || !hiddenItems.includes(i.item_no)),
    ...extraItems
      .filter((n) => !items.some((i) => i.item_no === n))
      .map((n) => ({ item_no: n, description: available.find((a) => a.item_no === n)?.description ?? "", cells: blankCells(months) })),
  ];
  const itemPlans = visible.filter((i) => i.cells.some((c) => c.firm > 0)).length;
  const gap = sumOf(row.cells, "gap");

  return (
    <>
      <tr className="sop-model">
        <td colSpan={span}>
          <button
            className="sop-model__toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} finished goods for ${row.model}`}
            title={expanded ? "Hide finished goods" : "Plan a specific finished good"}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <span className="sop-model__name">{row.model}</span>
          {row.series && <span className="sop-badge">{row.series}-series</span>}
          {itemPlans > 0 && (
            <span className="sop-badge sop-badge--ai">
              {itemPlans} item plan{itemPlans === 1 ? "" : "s"}
            </span>
          )}
        </td>
      </tr>
      <ValueRow label="Demand" values={row.cells.map((c) => c.demand)} total={sumOf(row.cells, "demand")} bold />
      <ValueRow label="Scheduled" values={row.cells.map((c) => c.scheduled)} total={sumOf(row.cells, "scheduled")} muted />
      <EditRow label="Firm Plan" layer="firm" keyBase={row.model} cells={row.cells} total={sumOf(row.cells, "firm")} onEdit={onEdit} />
      <EditRow label="Flex Plan" layer="flex" keyBase={row.model} cells={row.cells} total={sumOf(row.cells, "flex")} onEdit={onEdit} />
      {expanded && (
        <>
          <tr className="sop-note">
            <td colSpan={span}>
              <b>By finished good</b> — an item-level plan is kept separately from the model rows above, which stay
              capacity-only.
            </td>
          </tr>
          {visible.map((it) => (
            <ItemBlock key={it.item_no} model={row.model} item={it} onEdit={onEdit} />
          ))}
          <tr>
            <td colSpan={span} style={{ paddingLeft: 28 }}>
              <FgPicker
                selected={visible.map((i) => i.item_no)}
                options={[
                  ...items.map((i) => ({ item_no: i.item_no, description: i.description, locked: hasData(i.cells) })),
                  ...available.filter((a) => !items.some((i) => i.item_no === a.item_no)).map((a) => ({ ...a, locked: false })),
                ].sort((a, b) => a.item_no.localeCompare(b.item_no))}
                onToggle={onToggleItem}
              />
            </td>
          </tr>
        </>
      )}
      <tr className="sop-gap">
        <td>Gap</td>
        {row.cells.map((c) => (
          <td key={c.month} className={`num ${gapClass(c.gap)}`}>
            {c.gap === 0 && c.demand === 0 && c.effective_supply === 0 ? "—" : formatUnits(c.gap)}
          </td>
        ))}
        <td className={`num sop-total ${gapClass(gap)}`}>{formatUnits(gap)}</td>
      </tr>
    </>
  );
}

function ItemBlock({ model, item, onEdit }: { model: string; item: SopItem; onEdit: Edit }) {
  const demand = sumOf(item.cells, "demand");
  const scheduled = sumOf(item.cells, "scheduled");
  const key = `${model}|${item.item_no}`;
  return (
    <>
      <tr className="sop-item">
        <td colSpan={item.cells.length + 2}>
          <span className="sop-item__no">{item.item_no}</span>
          {item.description && <span className="sop-item__desc">{item.description}</span>}
        </td>
      </tr>
      {demand > 0 && <ValueRow label="↳ Demand" values={item.cells.map((c) => c.demand)} total={demand} indent />}
      {scheduled > 0 && <ValueRow label="↳ Scheduled" values={item.cells.map((c) => c.scheduled)} total={scheduled} muted indent />}
      <EditRow label="↳ Firm Plan" layer="firm" keyBase={key} cells={item.cells} total={sumOf(item.cells, "firm")} onEdit={onEdit} indent />
      <EditRow label="↳ Flex Plan" layer="flex" keyBase={key} cells={item.cells} total={sumOf(item.cells, "flex")} onEdit={onEdit} indent />
    </>
  );
}

function ValueRow({
  label,
  values,
  total,
  bold,
  muted,
  indent,
}: {
  label: string;
  values: number[];
  total: number;
  bold?: boolean;
  muted?: boolean;
  indent?: boolean;
}) {
  const cls = `${bold ? "sop-bold" : ""} ${muted ? "sop-muted" : ""}`;
  return (
    <tr className={indent ? "sop-indent" : undefined}>
      <td className={cls}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num ${cls}`} style={bold ? { fontWeight: 700 } : undefined}>
          {v ? formatUnits(v) : "—"}
        </td>
      ))}
      <td className={`num sop-total ${muted ? "sop-muted" : ""}`} style={bold ? { fontWeight: 800 } : undefined}>
        {formatUnits(total)}
      </td>
    </tr>
  );
}

function EditRow({
  label,
  layer,
  keyBase,
  cells,
  total,
  onEdit,
  indent,
}: {
  label: string;
  layer: "firm" | "flex";
  keyBase: string;
  cells: SopCell[];
  total: number;
  onEdit: Edit;
  indent?: boolean;
}) {
  return (
    <tr className={indent ? "sop-indent" : undefined}>
      <td>
        {label} <span style={{ fontSize: 10, color: "var(--warn)" }}>✎</span>
      </td>
      {cells.map((c) => {
        const v = c[layer];
        return (
          <td key={c.month} className="sop-edit">
            <input
              key={`${c.month}-${v}`}
              type="number"
              min={0}
              defaultValue={v || ""}
              placeholder="—"
              aria-label={`${label.replace("↳ ", "")} ${keyBase} ${monthLabel(c.month)}`}
              className={v ? "sop-cell sop-cell--set" : "sop-cell"}
              onChange={(e) => onEdit(keyBase, c.month, layer, e.target.value)}
            />
          </td>
        );
      })}
      <td className="num sop-total sop-muted">{formatUnits(total)}</td>
    </tr>
  );
}

function FgPicker({
  options,
  selected,
  onToggle,
}: {
  options: { item_no: string; description: string; locked?: boolean }[];
  selected: string[];
  onToggle: (item: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const term = q.trim().toLowerCase();
  const list = options.filter((o) => !term || `${o.item_no} ${o.description}`.toLowerCase().includes(term));
  const sel = new Set(selected);
  const optional = options.filter((o) => !o.locked);
  const allOn = optional.length > 0 && optional.every((o) => sel.has(o.item_no));
  return (
    <div ref={ref} className="sop-picker">
      <button
        className="sop-picker__btn"
        onClick={() => {
          setOpen(!open);
          setQ("");
        }}
      >
        <ChevronDown size={12} /> Finished goods in this sheet{" "}
        <span>
          {selected.length}/{options.length}
        </span>
      </button>
      {open && (
        <div className="sop-picker__panel">
          <div style={{ display: "flex", alignItems: "center" }}>
            <Search size={12} style={{ margin: "0 6px" }} />
            <input className="sop-picker__search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" aria-label="Search finished goods" />
          </div>
          {optional.length > 0 && (
            <button className="sop-picker__opt" style={{ fontWeight: 600, color: "var(--brand)" }} onClick={() => optional.forEach((o) => onToggle(o.item_no, !allOn))}>
              {allOn ? "Clear all optional rows" : "Select all"}
            </button>
          )}
          <div className="sop-picker__list">
            {list.map((o) => (
              <button
                key={o.item_no}
                className="sop-picker__opt"
                disabled={o.locked}
                title={o.locked ? "Always shown: this item has demand, scheduled supply or a saved plan" : undefined}
                onClick={() => onToggle(o.item_no, !sel.has(o.item_no))}
              >
                <span aria-hidden>{sel.has(o.item_no) ? <Check size={11} /> : <span style={{ display: "inline-block", width: 11 }} />}</span>
                <b style={{ fontFamily: "monospace" }}>{o.item_no}</b>
                <span className="sop-muted">{o.description}</span>
                {o.locked && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink3)" }}>has data</span>}
              </button>
            ))}
            {list.length === 0 && <div style={{ padding: 8, fontSize: 11.5, color: "var(--ink3)" }}>no match for “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
