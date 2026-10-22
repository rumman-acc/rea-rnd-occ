import { purchasePricingApi, salesPricingApi, type PricingApi } from "./api";
import type { PartyKey } from "./types";

/** Everything that differs between the sales and the purchase workbench. */
export interface PricingConfig {
  id: "sales" | "purchase";
  api: PricingApi;
  party: PartyKey;
  /** "Customer" / "Vendor" and plurals, as shown in column headers and options. */
  partyLabel: string;
  partyPlural: string;
  /** Item column header, e.g. "Item / finished good". */
  itemLabel: string;
  /** Column header and the meaning of the margin figure. */
  costLabel: string;
  marginLabel: string;
  /** Whether a positive margin is the good direction (sales) or savings versus cost (purchase). */
  lowMarginIsBad: boolean;
  /** Standard prices can be pushed to the BC item card (sales only). */
  itemCardPush: boolean;
  deriveLabel: string;
  deriveHint: string;
  deriveDone: string;
  specificTabLabel: string;
  standardTabLabel: string;
  specificListTitle: string;
  csvTemplate: string[];
  titles: { prices: string; pricehistory: string; priceaudit: string };
  subtitles: { prices: string; pricehistory: string; priceaudit: string };
  auditorTitle: string;
  jobsTitle: string;
  auditJobLabel: string;
  logTitle: string;
  reviewNote: (itemCards: number) => string;
  supersedeNoun: string;
  /** Verbs for the apply dialog. */
  amountNoun: string;
  logActions: Record<string, string>;
  exampleItem: string;
  emptyBook: string;
  sessionKey: string;
}

const COMMON_ACTIONS: Record<string, string> = {
  price_changed: "Price changed",
  price_failed: "Price rejected",
  apply: "Batch applied",
  upload: "File uploaded",
  edit_line: "Reviewer edited row",
  manual_price: "Price set manually",
  delete_price: "Price deleted",
  override_flag: "Warning overridden",
  recheck_batch: "Rows re-checked against BC (simulated)",
  pull_from_bc: "Pulled prices from BC (simulated)",
  external_sync: "External pricing app sync (simulated)",
  job_run: "Scheduled agent run",
  settings: "Settings changed",
};

export const SALES_PRICING: PricingConfig = {
  id: "sales",
  api: salesPricingApi,
  party: "customer",
  partyLabel: "Customer",
  partyPlural: "customers",
  itemLabel: "Item / finished good",
  costLabel: "Unit cost",
  marginLabel: "Margin",
  lowMarginIsBad: true,
  itemCardPush: true,
  deriveLabel: "Derive from invoice history",
  deriveHint: "Build a starting price book from what customers were actually invoiced (most recent price per item + customer)",
  deriveDone: "price(s) from posted invoices",
  specificTabLabel: "Customer-specific",
  standardTabLabel: "Standard (all customers)",
  specificListTitle: "Customer-specific price list",
  csvTemplate: [
    "Item No,Customer No,Quantity,Price,Currency,Effective Date",
    "FG-1000,C-01,0,660.00,USD,2026-11-01",
    "FG-1000,C-01,10,640.00,USD,2026-11-01",
    "FG-2000,ALL,0,545.00,USD,2026-11-01",
  ],
  titles: { prices: "Sales Price Lists", pricehistory: "Price Update History", priceaudit: "Customer Pricing Auditor" },
  subtitles: {
    prices: "The governed price book: standard and customer-specific, with quantity breaks. Load prices from a file, a watched folder or your pricing app. Base standard prices can post to the (simulated) BC item card.",
    pricehistory: "Every price file processed, with the original upload, the confirmation record and the immutable action log.",
    priceaudit: "A rule-based auditor reviewing open sales orders and posted sales invoices against the price book, the item cost and each customer's own history.",
  },
  auditorTitle: "Customer Pricing Auditor (rule-based)",
  jobsTitle: "Pricing agents (scheduled)",
  auditJobLabel: "Pricing audit sweep",
  logTitle: "Pricing action log (immutable)",
  reviewNote: (n) => `${n} standard base price(s) target the BC item card`,
  supersedeNoun: "prices",
  amountNoun: "price",
  logActions: { ...COMMON_ACTIONS, derive_from_history: "Derived from invoice history", audit_run: "Pricing audit run" },
  exampleItem: "FG-1000",
  emptyBook: "No prices in the book yet. Upload a price file, derive from invoice history, or add a single price.",
  sessionKey: "occ.pricing.openBatch",
};

export const PURCHASE_PRICING: PricingConfig = {
  ...SALES_PRICING,
  id: "purchase",
  api: purchasePricingApi,
  party: "vendor",
  partyLabel: "Vendor",
  partyPlural: "vendors",
  itemLabel: "Item / component",
  costLabel: "Last cost",
  marginLabel: "vs Last Cost",
  lowMarginIsBad: false,
  itemCardPush: false,
  deriveLabel: "Derive from purchase invoices",
  deriveHint: "Build a starting price book from what vendors actually invoiced (most recent price per item + vendor)",
  deriveDone: "price(s) from purchase invoices",
  specificTabLabel: "Vendor-specific",
  standardTabLabel: "Standard (all vendors)",
  specificListTitle: "Vendor-specific price list",
  csvTemplate: [
    "Item No,Vendor No,Quantity,Price,Currency,Effective Date",
    "CMP-A,V-100,0,40.00,USD,2026-11-01",
    "CMP-A,V-100,100,38.50,USD,2026-11-01",
    "CMP-B,ALL,0,18.00,USD,2026-11-01",
  ],
  titles: { prices: "Purchase Price Lists", pricehistory: "Price Update History", priceaudit: "Vendor Pricing Auditor" },
  subtitles: {
    prices: "The governed purchase price book: standard and vendor-specific, with quantity breaks. Load prices from a file, a watched folder or your pricing app. The (simulated) BC item Unit Cost is never touched.",
    pricehistory: "Every price file processed, with the original upload, the confirmation record and the immutable action log.",
    priceaudit: "A rule-based auditor reviewing open purchase orders and posted purchase invoices against the price book, the last costs paid and each vendor's own history.",
  },
  auditorTitle: "Vendor PurchPricing Auditor (rule-based)",
  jobsTitle: "PurchPricing agents (scheduled)",
  auditJobLabel: "Purchase pricing audit sweep",
  logTitle: "PurchPricing action log (immutable)",
  reviewNote: () => "all prices land in the governed purchase book (the BC item card Unit Cost is never touched)",
  supersedeNoun: "costs",
  amountNoun: "cost",
  logActions: { ...COMMON_ACTIONS, derive_from_history: "Derived from purchase invoices", audit_run: "Purchase pricing audit run" },
  exampleItem: "CMP-A",
  emptyBook: "No prices in the book yet. Upload a price file, derive from purchase invoices, or add a single price.",
  sessionKey: "occ.purchpricing.openBatch",
};
