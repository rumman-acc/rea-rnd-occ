"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PricingWorkbench, PURCHASE_PRICING, type PricingTab } from "@/features/pricing/Workbench";
import { BuyCockpit } from "./BuyCockpit";
import { OpenPos } from "./OpenPos";
import { PoHistory } from "./PoHistory";
import "./purchasing.css";

type Tab = "buy" | "orders" | "pohistory" | PricingTab;

const TABS: [Tab, string][] = [
  ["buy", "1 · Buy Cockpit"],
  ["orders", "2 · Open POs"],
  ["pohistory", "3 · PO History"],
  ["prices", "4 · Price Lists"],
  ["pricehistory", "5 · Price History"],
  ["priceaudit", "6 · Pricing Auditor"],
];

/** The /purchasing page: three own tabs and the shared pricing workbench (purchase domain) for the rest. */
export function Purchasing() {
  const [tab, setTab] = useState<Tab>("buy");
  const tabs = (
    <div className="pw-tabs" role="tablist" aria-label="Purchasing sections">
      {TABS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
  if (tab === "buy" || tab === "orders" || tab === "pohistory") {
    return (
      <div>
        <PageHeader
          title="Purchasing"
          sub="senior-buyer cockpit · open orders · PO history · the governed purchase price book and its auditor"
          actions={tabs}
        />
        {tab === "buy" && <BuyCockpit />}
        {tab === "orders" && <OpenPos />}
        {tab === "pohistory" && <PoHistory />}
      </div>
    );
  }
  return <PricingWorkbench config={PURCHASE_PRICING} tab={tab} tabs={tabs} onResumeReview={() => setTab("prices")} />;
}
