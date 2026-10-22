"use client";

/** Visible on each page of this module: the original page was never observed (SPEC-FULL D10). */
export function EvidenceNotice({ simulated }: { simulated?: string }) {
  return (
    <div className="notice notice--evidence" role="note" data-testid="evidence-notice">
      Reconstruction without original reference: no screen of this page was available, so layout and behavior are our own design.
      {simulated ? ` ${simulated}` : ""}
    </div>
  );
}
