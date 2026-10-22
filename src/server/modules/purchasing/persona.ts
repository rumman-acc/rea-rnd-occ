import { appendAudit } from "../../audit";
import { badRequest } from "../../http";
import type { Store } from "../../store";
import { HORIZONS, POSTURES, type Persona } from "./types";

const KEY = "purchasing:persona";

export const defaultPersona = (): Persona => ({
  name: "Senior Buyer (rule-based)",
  risk_posture: "balanced",
  delivery_padding_days: 3,
  horizon: "auto",
  respect_moq: true,
});

export const getPersona = (store: Store): Persona => store.get(KEY, defaultPersona);

/** Partial update: unknown keys are ignored, known keys are validated (REQ-PUR-API-002). */
export function putPersona(store: Store, actor: string, body: Record<string, unknown>): Persona {
  const next = getPersona(store);
  if (body.name !== undefined) {
    const n = typeof body.name === "string" ? body.name.trim() : "";
    if (n.length < 1 || n.length > 60) throw badRequest("name must be 1 to 60 characters");
    next.name = n;
  }
  if (body.risk_posture !== undefined) {
    if (!POSTURES.includes(body.risk_posture as never)) throw badRequest(`risk_posture must be one of ${POSTURES.join(", ")}`);
    next.risk_posture = body.risk_posture as Persona["risk_posture"];
  }
  if (body.horizon !== undefined) {
    if (!HORIZONS.includes(body.horizon as never)) throw badRequest(`horizon must be one of ${HORIZONS.join(", ")}`);
    next.horizon = body.horizon as Persona["horizon"];
  }
  if (body.delivery_padding_days !== undefined) {
    const d = body.delivery_padding_days;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 30) throw badRequest("delivery_padding_days must be an integer from 0 to 30");
    next.delivery_padding_days = d;
  }
  if (body.respect_moq !== undefined) {
    if (typeof body.respect_moq !== "boolean") throw badRequest("respect_moq must be true or false");
    next.respect_moq = body.respect_moq;
  }
  store.set(KEY, next);
  appendAudit(store, {
    source: "purchasing", actor, action: "Buyer persona updated",
    detail: `${next.risk_posture} · horizon ${next.horizon} · ${next.delivery_padding_days}d early · ${next.respect_moq ? "MOQ" : "exact"}`,
  });
  return next;
}
