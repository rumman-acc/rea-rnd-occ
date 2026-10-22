import { seriesSummaries } from "@/domain/derive";
import { formatUnits } from "@/domain/format";
import type { Health, StatusRow } from "@/domain/types";

// Bar width and color follow the worst health among a series' rows (SPEC SUP-003).
const WIDTH: Record<Health, number> = { green: 100, yellow: 65, red: 30 };

export function SupplyHealth({ rows }: { rows: readonly StatusRow[] }) {
  return (
    <div className="supply">
      {seriesSummaries(rows).map((s) => (
        <div className="supply__item" key={s.series}>
          <div className="supply__head">
            <span className="supply__name">{s.series}</span>
            <span className="supply__units">{formatUnits(s.total)} units</span>
          </div>
          <div className="supply__track">
            <div
              className={`supply__fill supply__fill--${s.worst}`}
              data-testid={`supply-bar-${s.series}`}
              data-health={s.worst}
              style={{ width: `${WIDTH[s.worst]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
