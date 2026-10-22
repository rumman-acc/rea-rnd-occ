"use client";

import { useState, type ReactNode } from "react";
import { AssistantButton } from "./AssistantButton";
import { ErrorBanner } from "./ErrorBanner";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { SimulationBanner } from "./SimulationBanner";

/** App frame: sidebar, header, banners, scrolling main (SPEC FR-002). Collapsed state is not persisted. */
export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <div className="shell">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div className="shell__col">
          <Header />
          <SimulationBanner />
          <ErrorBanner />
          <main className="shell__main">{children}</main>
        </div>
      </div>
      <AssistantButton />
    </>
  );
}
