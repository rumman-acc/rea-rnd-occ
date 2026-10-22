"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { appConfig } from "@/config/branding";
import { NAV_ITEMS } from "@/config/nav";
import { formatClockTime } from "@/domain/format";
import { usePlan } from "@/state/PlanState";
import { useRuntime } from "@/runtime/runtime";
import { ProfileMenu } from "./ProfileMenu";

export function Header() {
  const pathname = usePathname();
  const { plan, loading, error, refresh } = usePlan();
  const rt = useRuntime();
  const label = NAV_ITEMS.find((i) => i.href === pathname)?.label ?? appConfig.productName;

  return (
    <header className="header">
      <div>
        <div className="header__title">{label}</div>
        <div className="header__sub">{appConfig.productName} · Operations Control Center</div>
      </div>
      <div className="header__right">
        <span className="status">
          <span className={error ? "status__dot status__dot--bad" : "status__dot"} data-testid="status-dot" />
          <span data-testid="status-text">{error ? "Offline" : "Demo data"}</span>
        </span>
        {plan && (
          <span className="asof">
            as of <span className="asof__time">{formatClockTime(plan.generated_at, rt)}</span>
          </span>
        )}
        <button type="button" className="btn btn--outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={12} className={loading ? "spin" : undefined} aria-hidden="true" /> Refresh
        </button>
        <ProfileMenu />
      </div>
    </header>
  );
}
