"use client";

import { TriangleAlert } from "lucide-react";
import { usePlan } from "@/state/PlanState";

/** Shown only when the plan failed to load and no plan is held (SPEC FR-008). */
export function ErrorBanner() {
  const { error, plan } = usePlan();
  if (!error || plan) return null;
  return (
    <div className="errorbanner" role="alert">
      <p className="errorbanner__title">
        <TriangleAlert size={15} aria-hidden="true" /> Could not load the plan.
      </p>
      <p className="errorbanner__msg">{error}</p>
      <p className="errorbanner__hint">The data provider could not return the plan.</p>
    </div>
  );
}
