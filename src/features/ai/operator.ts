const KEY = "occ_operator";

/** The human id journaled on every initiation, approval and edit (persisted per browser). */
export function getOperator(): string {
  try {
    return localStorage.getItem(KEY) || "operator";
  } catch {
    return "operator";
  }
}

export function setOperator(v: string): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // storage unavailable
  }
}

/** HH:MM:SS, 24 h, en-US. */
export function clock(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString("en-US", { hour12: false }) : "—";
}
