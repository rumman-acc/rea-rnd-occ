import type { KpiTone } from "@/domain/derive";

export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone: KpiTone;
}) {
  return (
    <div className={`kpi kpi--${tone}`} data-testid="kpi-card" data-tone={tone}>
      <div className="kpi__bar" />
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__sub">{sub}</div>
    </div>
  );
}
