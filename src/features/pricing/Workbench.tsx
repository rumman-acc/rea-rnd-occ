"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AuditorView } from "./Auditor";
import type { PricingConfig } from "./config";
import { PriceHistoryView } from "./PriceHistory";
import { PriceListsView } from "./PriceLists";
import "./pricing.css";

export type PricingTab = "prices" | "pricehistory" | "priceaudit";

export const PRICING_TABS: PricingTab[] = ["prices", "pricehistory", "priceaudit"];

/**
 * The shared pricing workbench, one tab at a time. The host page owns the tab bar and passes
 * it in as `tabs`; it is rendered in the page header actions (as the original did).
 * `onResumeReview` is called from Price History to jump back to the Price Lists tab; the
 * batch to resume is remembered in sessionStorage under `config.sessionKey`.
 */
export function PricingWorkbench({
  config, tab, tabs, onResumeReview,
}: {
  config: PricingConfig;
  tab: PricingTab;
  tabs: ReactNode;
  onResumeReview?: () => void;
}) {
  const header = <PageHeader title={config.titles[tab]} sub={config.subtitles[tab]} actions={tabs} />;
  if (tab === "prices") return <PriceListsView config={config} header={header} />;
  if (tab === "pricehistory") {
    return (
      <PriceHistoryView
        config={config} header={header}
        onResumeReview={(id) => {
          try {
            sessionStorage.setItem(config.sessionKey, id);
          } catch {
            // not persisted: the user opens the batch from the list instead
          }
          onResumeReview?.();
        }}
      />
    );
  }
  return <AuditorView config={config} header={header} />;
}

export { SALES_PRICING, PURCHASE_PRICING, type PricingConfig } from "./config";
export { salesPricingApi, purchasePricingApi, createPricingApi, type PricingApi } from "./api";
