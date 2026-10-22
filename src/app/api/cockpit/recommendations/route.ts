import { handle } from "@/server/http";
import { recommendations } from "@/server/modules/purchasing/engine";
import { getPersona } from "@/server/modules/purchasing/persona";
import { nowIso } from "@/server/clock";

// ?refresh=true is accepted for client compatibility; nothing is cached, every call recomputes.
export const GET = handle(({ store }) => ({
  persona: getPersona(store),
  generated_at: nowIso().slice(0, 19),
  engine: "rule-based",
  lines: recommendations(store),
}));
