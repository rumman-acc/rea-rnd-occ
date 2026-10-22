"use client";

import { FlaskConical, LoaderCircle } from "lucide-react";
import { usePlan } from "@/state/PlanState";

/** Shown in every page while simulation mode is on; nothing simulated is saved. */
export function SimulationBanner() {
  const { simMode, simOverrides, simBusy, discardSim } = usePlan();
  if (!simMode) return null;
  const n = simOverrides.length;
  return (
    <div className="simbanner" role="status">
      <div className="simbanner__text">
        <FlaskConical size={15} aria-hidden="true" />
        Simulation Mode — {n} reschedule{n === 1 ? "" : "s"} applied
        {simBusy && <LoaderCircle size={13} className="spin" aria-label="Simulating" />}
        <span className="simbanner__sub">KPIs, board and capacity show the simulated schedule. Nothing is saved.</span>
      </div>
      <button type="button" className="btn btn--danger" onClick={discardSim}>
        Exit &amp; Discard
      </button>
    </div>
  );
}
