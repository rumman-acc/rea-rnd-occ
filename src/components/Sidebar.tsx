"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { appConfig } from "@/config/branding";
import { NAV } from "@/config/nav";
import { useDataProvider } from "@/data/provider";
import { redCount } from "@/domain/derive";
import { usePlan } from "@/state/PlanState";
import { BrandMark } from "./BrandMark";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { plan } = usePlan();
  const provider = useDataProvider();
  const [version, setVersion] = useState<string | null>(null);

  // Version is optional: omitted until loaded, or if the provider fails (SPEC FR-014).
  useEffect(() => {
    let live = true;
    provider
      .getVersion()
      .then((v) => live && setVersion(v.version))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider]);

  const badge = plan ? redCount(plan.status_board) : 0;

  return (
    <aside className={collapsed ? "sidebar sidebar--collapsed" : "sidebar"} data-testid="sidebar">
      <div className="sidebar__brand">
        <BrandMark />
        {!collapsed && (
          <div className="sidebar__brandtext">
            <div className="sidebar__product">{appConfig.productName}</div>
            <div className="sidebar__tagline">Operations Control Center</div>
          </div>
        )}
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {NAV.map((group) => (
          <div key={group.group}>
            {!collapsed && <div className="sidebar__group">{group.group}</div>}
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? "navitem navitem--active" : "navitem"}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={15} className="navitem__icon" aria-hidden="true" />
                  {!collapsed && <span className="navitem__label">{label}</span>}
                  {href === "/" && badge > 0 && !collapsed && (
                    <span className="navitem__badge" data-testid="nav-badge">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        {!collapsed && version && <div className="sidebar__version">v{version} · Demo</div>}
        <button type="button" className="sidebar__collapse" onClick={onToggle}>
          {collapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
          {collapsed && <span className="sr-only">Expand</span>}
        </button>
      </div>
    </aside>
  );
}
