"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Completed } from "./Completed";
import { History } from "./History";
import { Moves } from "./Moves";
import { Receiving } from "./Receiving";
import { Settings } from "./Settings";
import "./warehouse.css";

const TABS = [
  ["receiving", "1 · Receiving"],
  ["completed", "2 · Completed POs"],
  ["warehouse", "3 · Inventory & Moves"],
  ["history", "4 · History"],
  ["settings", "5 · Settings"],
] as const;

type Tab = (typeof TABS)[number][0];

export function Warehouse() {
  const [tab, setTab] = useState<Tab>("receiving");
  return (
    <div className="wh">
      <PageHeader title="Warehousing" sub="receiving with lot & bin capture · inventory movements & adjustments — everything journaled" />
      <div className="tabs" role="tablist" aria-label="Warehouse sections">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "tab--active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "receiving" && <Receiving />}
      {tab === "completed" && <Completed />}
      {tab === "warehouse" && <Moves />}
      {tab === "history" && <History />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
