"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { appConfig } from "@/config/branding";
import { atRiskRows, criticalTone, linkedTone, onTimeTone } from "@/domain/derive";
import { formatLongDate, formatMoney, formatUnits } from "@/domain/format";
import { usePlan } from "@/state/PlanState";
import { useRuntime } from "@/runtime/runtime";
import { Card } from "./Card";
import { BarChart, DonutChart } from "./charts";
import { KpiCard } from "./KpiCard";
import { OrdersTable } from "./OrdersTable";
import { SupplyHealth } from "./SupplyHealth";

/** The Operations Dashboard page content (SPEC §2.3–2.8). */
export function Dashboard() {
  const { plan, loading, effective } = usePlan();
  const rt = useRuntime();

  if (loading && !plan) {
    return (
      <div className="loading" role="status">
        <LoaderCircle className="spin" size={18} /> Loading plan…
      </div>
    );
  }
  // No plan or no KPIs: render nothing; the shell shows the error banner (FR-023).
  const kpis = effective.kpis;
  if (!plan || !kpis) return null;

  // Simulation mode shows the simulated plan; otherwise `effective` is the base plan.
  const rows = effective.status_board;
  const atRisk = atRiskRows(rows);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Operations Dashboard</h1>
          <p className="page-header__sub">
            {appConfig.companyName} · {formatLongDate(rt)}
          </p>
        </div>
        <div className="page-header__actions">
          <Link href="/sop" className="btn btn--outline">
            S&amp;OP View →
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Open SO Lines" value={kpis.open_so_lines} sub={`${formatUnits(kpis.open_units)} units`} tone="blue" />
        <KpiCard label="Open Order Value" value={formatMoney(kpis.open_value)} sub="outstanding revenue" tone="blue" />
        <KpiCard label="On-Time Coverage" value={`${kpis.on_time_pct}%`} sub="linked POs ending in time" tone={onTimeTone(kpis.on_time_pct)} />
        <KpiCard label="PO Linkage" value={`${kpis.linked_pct}%`} sub="SOs with a production order" tone={linkedTone(kpis.linked_pct)} />
        <KpiCard
          label="Critical Materials"
          value={kpis.critical_items}
          sub={`${kpis.expedite_lines} expedites needed`}
          tone={criticalTone(kpis.critical_items)}
        />
        <KpiCard label="Revenue at Risk" value={formatMoney(kpis.revenue_at_risk)} sub="red + partial yellow exposure" tone="amber" />
      </div>

      <div className="chart-grid">
        <Card title="Order Book Health">
          <DonutChart rows={rows} />
        </Card>
        <Card title="Open Demand by Series (units)">
          <BarChart rows={rows} />
        </Card>
      </div>

      <div className="bottom-grid">
        <Card
          title="At-Risk Sales Orders"
          bodyClassName="card__body--table"
          actions={
            <Link href="/orders" className="btn btn--outline btn--small">
              View all
            </Link>
          }
        >
          <OrdersTable rows={atRisk} />
        </Card>
        <Card title="Supply Health by Series">
          <SupplyHealth rows={rows} />
        </Card>
      </div>
    </div>
  );
}
