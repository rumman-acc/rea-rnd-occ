// Brand-neutral defaults (SPEC NF-004, ARC-009). Replace per deployment.

export interface AppConfig {
  productName: string;
  companyName: string;
  /** Label of the inert assistant button (SPEC FR-007). */
  assistantLabel: string;
}

export const appConfig: AppConfig = {
  productName: "Acme OCC",
  companyName: "Acme Industries Inc.",
  assistantLabel: "Ask Fluid",
};
