"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { appConfig } from "@/config/branding";
import * as api from "./api";
import { ErrorNote, errText, EvidenceNotice, Loading, money, money2, Pill, Table, Tabs, useLoad } from "./ui";

const TABS = ["Dashboard", "General Ledger", "Trial Balance", "Income Statement", "Balance Sheet", "Budget", "Receivables", "Payables", "Margin by Series", "Cash Forecast"] as const;
type Tab = (typeof TABS)[number];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Buckets({ aging }: { aging: api.Aging<unknown> }) {
  return (
    <div className="fin-buckets" data-testid="buckets">
      {aging.buckets.map((b) => (
        <div key={b.key} className={b.key === "overdue" && b.amount > 0 ? "fin-bucket fin-bucket--bad" : "fin-bucket"}>
          <div className="fin-bucket__label">{b.label}</div>
          <div className="fin-bucket__amount">{money(b.amount)}</div>
          <div className="fin-bucket__count">{b.count} line(s)</div>
        </div>
      ))}
    </div>
  );
}

function DashboardTab({ d }: { d: api.Dashboard }) {
  const g = d.gl;
  const o = d.operational.kpis;
  return (
    <div className="stack">
      <div className="kpi-grid">
        <KpiCard label="Revenue (month)" value={money(g.revenue_month)} sub={`${money(g.revenue_ytd)} year to date`} tone="blue" />
        <KpiCard label="Net Income (month)" value={money(g.net_income_month)} sub={`${money(g.net_income_ytd)} year to date`} tone={g.net_income_month < 0 ? "red" : "green"} />
        <KpiCard label="Cash" value={money(g.cash)} sub="ledger account 1000" tone="blue" />
        <KpiCard label="Receivables" value={money(g.receivables)} sub="ledger account 1100" tone="blue" />
        <KpiCard label="Payables" value={money(g.payables)} sub="ledger account 2000" tone="blue" />
        <KpiCard label="Inventory" value={money(g.inventory)} sub="ledger account 1200" tone="blue" />
      </div>
      <div className="kpi-grid">
        <KpiCard label="Overdue Receivables" value={money(o.overdue_receivables)} sub={`as of ${d.as_of}`} tone={o.overdue_receivables > 0 ? "red" : "green"} />
        <KpiCard label="Open Commitments" value={money(o.open_commitments)} sub="open vendor PO lines" tone="blue" />
        <KpiCard label="Gross Margin" value={`${o.gross_margin_pct}%`} sub="open orders, materials cost" tone="green" />
        <KpiCard label="Revenue at Risk" value={money(o.revenue_at_risk)} sub={`${o.revenue_at_risk_pct}% of open order value`} tone={o.revenue_at_risk > 0 ? "amber" : "green"} />
        <KpiCard label="Minimum Cash" value={money(o.min_cash)} sub="13-week forecast" tone={o.min_cash < 0 ? "red" : "blue"} />
        <KpiCard label="Ledger" value={`${g.documents} docs`} sub={`${g.lines} lines`} tone={g.trial_balance_balanced ? "green" : "red"} />
      </div>
      <p>
        Trial balance: <Pill ok={g.trial_balance_balanced} yes="Balanced" no="Out of balance" />
        {d.budget.has_budget ? (
          <span data-testid="budget-variance">
            {" "}
            Budget (month): revenue {money(d.budget.revenue.actual)} vs {money(d.budget.revenue.budget)} ({money(d.budget.revenue.variance)}); expenses {money(d.budget.expenses.actual)} vs {money(d.budget.expenses.budget)} ({money(d.budget.expenses.variance)})
          </span>
        ) : (
          <span> No budget for {d.year}; create one in the Budget tab.</span>
        )}
      </p>
      <Card title={`Monthly result ${d.year}`} bodyClassName="card__body--table">
        <Table head={["Month", "Revenue", "Expenses", "Net income"]} numeric={[1, 2, 3]} empty="" rows={d.months.map((m) => [MONTHS[m.month - 1], money(m.revenue), money(m.expenses), money(m.net_income)])} />
      </Card>
    </div>
  );
}

function GlTab({ d }: { d: api.Dashboard }) {
  const [f, setF] = useState({ account_no: "", source: "", date_from: "", date_to: "", q: "" });
  const [offset, setOffset] = useState(0);
  const [doc, setDoc] = useState<api.GlDocument | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const facets = useLoad(() => api.getFacets(), [d.year]);
  const page = useLoad(() => api.getGl({ ...f, limit: 25, offset }), [f, offset]);
  const set = (k: keyof typeof f, v: string) => {
    setOffset(0);
    setF({ ...f, [k]: v });
  };
  const open = async (no: string) => {
    try {
      setDoc(await api.getDocument(no));
      setDocErr(null);
    } catch (e) {
      setDocErr(errText(e));
    }
  };
  const p = page.data;
  return (
    <div className="stack">
      <Card title="General ledger" bodyClassName="card__body--table">
        <div className="fin-form">
          <label>
            Account
            <select className="select" aria-label="Account" value={f.account_no} onChange={(e) => set("account_no", e.target.value)}>
              <option value="">All accounts</option>
              {facets.data?.accounts.map((a) => (
                <option key={a.account_no} value={a.account_no}>
                  {a.account_no} {a.name} ({a.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select className="select" aria-label="Source" value={f.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">All sources</option>
              {facets.data?.sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.source} ({s.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" className="input" aria-label="GL from" value={f.date_from} onChange={(e) => set("date_from", e.target.value)} />
          </label>
          <label>
            To
            <input type="date" className="input" aria-label="GL to" value={f.date_to} onChange={(e) => set("date_to", e.target.value)} />
          </label>
          <label>
            Search
            <input className="input" aria-label="Search" value={f.q} onChange={(e) => set("q", e.target.value)} />
          </label>
        </div>
        {page.error && <ErrorNote message={page.error} />}
        {!p && page.loading && <Loading text="Loading ledger…" />}
        {p && (
          <>
            <Table
              head={["Date", "Document", "Account", "Description", "Source", "Debit", "Credit"]}
              numeric={[5, 6]}
              empty="No ledger lines match."
              rows={p.lines.map((l) => [
                l.posting_date,
                <button key="d" className="btn btn--small" onClick={() => void open(l.document_no)}>
                  {l.document_no}
                </button>,
                `${l.account_no} ${l.account_name}`,
                l.description,
                l.source,
                l.debit ? money2(l.debit) : "",
                l.credit ? money2(l.credit) : "",
              ])}
            />
            <div className="fin-form">
              <span data-testid="gl-total">
                {p.total} line(s); debit {money2(p.totals.debit)}, credit {money2(p.totals.credit)}
              </span>
              <button className="btn btn--small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - p.limit))}>
                Previous
              </button>
              <button className="btn btn--small" disabled={offset + p.limit >= p.total} onClick={() => setOffset(offset + p.limit)}>
                Next
              </button>
            </div>
          </>
        )}
      </Card>
      {docErr && <ErrorNote message={docErr} />}
      {doc && (
        <Card title={`Document ${doc.document_no}`} actions={<button className="btn btn--small" onClick={() => setDoc(null)}>Close</button>}>
          <p data-testid="doc-panel">
            {doc.posting_date} · {doc.source} · {doc.description} · <Pill ok={doc.balanced} yes="Balanced" no="Unbalanced" />
          </p>
          <Table head={["Account", "Debit", "Credit"]} numeric={[1, 2]} empty="" rows={doc.lines.map((l) => [`${l.account_no} ${l.account_name}`, l.debit ? money2(l.debit) : "", l.credit ? money2(l.credit) : ""])} />
        </Card>
      )}
    </div>
  );
}

function TrialBalanceTab({ d }: { d: api.Dashboard }) {
  const [from, setFrom] = useState(`${d.year}-01-01`);
  const [to, setTo] = useState(d.date_to);
  const r = useLoad(() => api.getTrialBalance(from, to), [from, to]);
  const t = r.data;
  return (
    <Card title="Trial balance" bodyClassName="card__body--table">
      <div className="fin-form">
        <label>
          From
          <input type="date" className="input" aria-label="TB from" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" className="input" aria-label="TB to" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        {t && <Pill ok={t.balanced} yes="Debits equal credits" no="Out of balance" />}
      </div>
      {r.error && <ErrorNote message={r.error} />}
      {!t && r.loading && <Loading text="Loading trial balance…" />}
      {t && (
        <Table
          head={["Account", "Name", "Opening", "Debit", "Credit", "Closing"]}
          numeric={[2, 3, 4, 5]}
          empty="No postings in the period."
          rows={[
            ...t.rows.map((x) => [x.account_no, x.name, money2(x.opening), money2(x.debit), money2(x.credit), money2(x.closing)]),
            ["", "Total", money2(t.totals.opening), money2(t.totals.debit), money2(t.totals.credit), money2(t.totals.closing)],
          ]}
        />
      )}
    </Card>
  );
}

function IncomeTab({ d }: { d: api.Dashboard }) {
  const r = useLoad(() => api.getIncomeStatement(d.year, d.month), [d.year, d.month]);
  const s = r.data;
  return (
    <Card title={`Income statement ${MONTHS[d.month - 1]} ${d.year}`} bodyClassName="card__body--table">
      {r.error && <ErrorNote message={r.error} />}
      {!s && r.loading && <Loading text="Loading income statement…" />}
      {s && (
        <>
          <Table
            head={["Account", "Name", "Month", "Year to date"]}
            numeric={[2, 3]}
            empty=""
            rows={[
              ...s.sections.flatMap((sec) => [
                [<strong key={sec.title}>{sec.title}</strong>, "", "", ""],
                ...sec.lines.map((l) => [l.account_no, l.name, money2(l.month), money2(l.ytd)]),
                ["", `Total ${sec.title.toLowerCase()}`, money2(sec.month_total), money2(sec.ytd_total)],
              ]),
              [<strong key="n">Net income</strong>, "", <strong key="m">{money2(s.net_income.month)}</strong>, <strong key="y">{money2(s.net_income.ytd)}</strong>],
            ]}
          />
          {s.unmapped_accounts.length > 0 && <p className="notice notice--warn">Accounts with postings missing from the layout: {s.unmapped_accounts.join(", ")}</p>}
        </>
      )}
    </Card>
  );
}

function BalanceTab({ d }: { d: api.Dashboard }) {
  const [asOf, setAsOf] = useState(d.date_to);
  const r = useLoad(() => api.getBalanceSheet(asOf), [asOf]);
  const b = r.data;
  return (
    <Card title="Balance sheet" bodyClassName="card__body--table">
      <div className="fin-form">
        <label>
          As of
          <input type="date" className="input" aria-label="BS as of" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </label>
        {b && <Pill ok={b.balanced} yes="Balanced" no="Out of balance" />}
      </div>
      {r.error && <ErrorNote message={r.error} />}
      {!b && r.loading && <Loading text="Loading balance sheet…" />}
      {b && (
        <>
          <Table
            head={["Account", "Name", "Balance"]}
            numeric={[2]}
            empty=""
            rows={[
              ...b.sections.flatMap((sec) => [
                [<strong key={sec.title}>{sec.title}</strong>, "", ""],
                ...sec.lines.map((l) => [l.account_no, l.name, money2(l.balance)]),
                ["", `Total ${sec.title.toLowerCase()}`, money2(sec.total)],
              ]),
              ["", "Current earnings (not yet closed)", money2(b.current_earnings)],
              [<strong key="a">Debit side</strong>, "", <strong key="d">{money2(b.total_debit_side)}</strong>],
              [<strong key="c">Credit side incl. earnings</strong>, "", <strong key="e">{money2(b.total_credit_side)}</strong>],
            ]}
          />
          {b.unmapped_accounts.length > 0 && <p className="notice notice--warn">Accounts with balances missing from the layout: {b.unmapped_accounts.join(", ")}</p>}
        </>
      )}
    </Card>
  );
}

function BudgetTab({ d }: { d: api.Dashboard }) {
  const [year, setYear] = useState(String(d.year));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [srcYear, setSrcYear] = useState(String(d.year));
  const [factor, setFactor] = useState("1.1");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const y = Number(year);
  const r = useLoad(async () => {
    const b = await api.getBudget(y);
    setVals(Object.fromEntries(b.entries.map((e) => [`${e.account_no}/${e.month}`, String(e.amount)])));
    return b;
  }, [y]);
  const b = r.data;
  const act = async (fn: () => Promise<api.Budget>, done: string) => {
    try {
      const out = await fn();
      setVals(Object.fromEntries(out.entries.map((e) => [`${e.account_no}/${e.month}`, String(e.amount)])));
      setErr(null);
      setMsg(done);
      await r.reload();
    } catch (e) {
      setMsg(null);
      setErr(errText(e));
    }
  };
  const save = () =>
    act(() => {
      const entries = Object.entries(vals)
        .filter(([, v]) => v.trim() !== "")
        .map(([k, v]) => ({ account_no: k.split("/")[0], month: Number(k.split("/")[1]), amount: Number(v) }));
      return api.saveBudget(y, entries);
    }, `Budget ${year} saved`);
  return (
    <Card title="Budget" bodyClassName="card__body--table">
      <div className="fin-form">
        <label>
          Year
          <input className="input" aria-label="Budget year" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <button className="btn btn--primary" onClick={() => void save()}>
          Save budget
        </button>
        <label>
          Seed from year
          <input className="input" aria-label="Seed source year" value={srcYear} onChange={(e) => setSrcYear(e.target.value)} />
        </label>
        <label>
          Factor
          <input className="input" aria-label="Seed factor" value={factor} onChange={(e) => setFactor(e.target.value)} />
        </label>
        <button className="btn" onClick={() => void act(() => api.seedBudget(y, Number(srcYear), Number(factor)), `Budget ${year} seeded from ${srcYear}`)}>
          Seed from actuals
        </button>
      </div>
      {err && <ErrorNote message={err} />}
      {msg && <p className="notice" role="status">{msg}</p>}
      {r.error && <ErrorNote message={r.error} />}
      {!b && r.loading && <Loading text="Loading budget…" />}
      {b && (
        <>
          <p data-testid="budget-totals">
            Budget revenue {money2(b.total_revenue)}, expenses {money2(b.total_expenses)}
          </p>
          <div className="table-scroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Account</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.accounts.map((a) => (
                  <tr key={a.account_no}>
                    <td>
                      {a.account_no} {a.name}
                    </td>
                    {MONTHS.map((m, i) => (
                      <td key={m} className="num">
                        <input
                          className="input fin-cell"
                          aria-label={`${a.account_no} month ${i + 1}`}
                          value={vals[`${a.account_no}/${i + 1}`] ?? ""}
                          onChange={(e) => setVals({ ...vals, [`${a.account_no}/${i + 1}`]: e.target.value })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** /finance: a ledger-centric Financial Control Center (spec/finance.md). A reconstruction without original reference. */
export function FinanceCenter() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [full, setFull] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const dash = useLoad(() => api.getDashboard(year, month), [year, month, version]);
  const status = useLoad(() => api.getSyncStatus(), [version]);
  const d = dash.data;

  const doSync = async () => {
    try {
      const r = await api.runSync(full);
      setSyncMsg(`Simulated ${full ? "full" : "incremental"} sync done: ${r.added_lines} line(s) added`);
      setSyncErr(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setSyncErr(errText(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Financial Control Center"
        sub={`${appConfig.companyName} · ${d ? `${MONTHS[d.month - 1]} ${d.year}` : "…"}`}
        actions={
          <div className="toolbar">
            <select
              className="select"
              aria-label="Year"
              value={year ?? d?.year ?? ""}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setMonth(month ?? d?.month);
              }}
            >
              {Array.from({ length: 7 }, (_, i) => (year ?? d?.year ?? 2026) - 3 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Month"
              value={month ?? d?.month ?? 1}
              onChange={(e) => {
                setMonth(Number(e.target.value));
                setYear(year ?? d?.year);
              }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <button className="btn btn--outline" onClick={() => setVersion((v) => v + 1)} disabled={dash.loading}>
              <RefreshCw size={14} className={dash.loading ? "spin" : undefined} /> Refresh
            </button>
          </div>
        }
      />
      <EvidenceNotice>
        Reconstruction without original reference: the original page was not captured. Only its API endpoints are known; screens, ledger and figures here are demo data derived from master data.
      </EvidenceNotice>
      <div className="fin-form" data-testid="sync-bar">
        <span>
          Ledger sync ({status.data?.connector ?? "simulated connector"}): {status.data?.last_sync_at ? `last ${status.data.last_mode} sync ${status.data.last_sync_at.slice(0, 19).replace("T", " ")}` : "never synced"}
        </span>
        <label>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full
        </label>
        <button className="btn btn--small" onClick={() => void doSync()}>
          Sync now (simulated)
        </button>
        {syncMsg && <span role="status">{syncMsg}</span>}
      </div>
      {syncErr && <ErrorNote message={syncErr} />}
      {dash.error && <ErrorNote message={dash.error} />}
      {!d && dash.loading && <Loading text="Loading finance…" />}
      {d && (
        <div className="stack">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {tab === "Dashboard" && <DashboardTab d={d} />}
          {tab === "General Ledger" && <GlTab key={version} d={d} />}
          {tab === "Trial Balance" && <TrialBalanceTab key={`${version}-${d.year}`} d={d} />}
          {tab === "Income Statement" && <IncomeTab key={version} d={d} />}
          {tab === "Balance Sheet" && <BalanceTab key={`${version}-${d.year}-${d.month}`} d={d} />}
          {tab === "Budget" && <BudgetTab key={`${version}-${d.year}`} d={d} />}
          {tab === "Receivables" && (
            <Card title="Receivables aging (open sales lines)" bodyClassName="card__body--table">
              <Buckets aging={d.operational.receivables} />
              <Table
                head={["Sales order", "Customer", "Series", "Delivery", "Due", "Days to due", "Amount"]}
                numeric={[5, 6]}
                empty="No open receivables."
                rows={d.operational.receivables.lines.map((l) => [`${l.so_number}/${l.line_no}`, l.customer_name, l.series ?? "—", l.delivery_date, l.due_date, l.days_to_due, money2(l.amount)])}
              />
            </Card>
          )}
          {tab === "Payables" && (
            <Card title="Payables and commitments (open vendor PO lines)" bodyClassName="card__body--table">
              <Buckets aging={d.operational.payables} />
              <Table
                head={["Vendor PO", "Vendor", "Component", "Receipt", "Due", "Days to due", "Amount"]}
                numeric={[5, 6]}
                empty="No open vendor PO lines."
                rows={d.operational.payables.lines.map((l) => [`${l.po_number}/${l.line_no}`, l.vendor_name, l.component_item_no, l.receipt_date, l.due_date, l.days_to_due, money2(l.amount)])}
              />
            </Card>
          )}
          {tab === "Margin by Series" && (
            <Card title="Margin by series (BOM material cost roll-up)" bodyClassName="card__body--table">
              <Table
                head={["Series", "Units", "Revenue", "Cost", "Margin", "Margin %"]}
                numeric={[1, 2, 3, 4, 5]}
                empty="No sales lines."
                rows={[
                  ...d.operational.margin.series.map((s) => [s.series, s.quantity, money2(s.revenue), money2(s.cost), money2(s.margin), `${s.margin_pct}%`]),
                  ["Total", d.operational.margin.total.quantity, money2(d.operational.margin.total.revenue), money2(d.operational.margin.total.cost), money2(d.operational.margin.total.margin), `${d.operational.margin.total.margin_pct}%`],
                ]}
              />
            </Card>
          )}
          {tab === "Cash Forecast" && (
            <Card title={`Cash forecast from ledger cash ${money(d.operational.cash.opening)}`} bodyClassName="card__body--table">
              <Table
                head={["Week", "From", "To", "Inflow", "Outflow", "Net", "Closing"]}
                numeric={[3, 4, 5, 6]}
                empty="No forecast."
                rows={d.operational.cash.weeks.map((w) => [w.index + 1, w.start, w.end, money(w.inflow), money(w.outflow), money(w.net), money(w.closing)])}
              />
              <p className="notice fin-notice">
                Due beyond 13 weeks (excluded): inflow {money(d.operational.cash.beyond_horizon.inflow)}, outflow {money(d.operational.cash.beyond_horizon.outflow)}.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
