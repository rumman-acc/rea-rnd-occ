import { get, post, put } from "@/lib/api/request";
import type { OpenPo, Persona, PoHistoryRow, PostLine, PostResult, Projection, PurchaseEntry, Recommendations } from "./types";

export const getPersona = () => get<Persona>("/api/cockpit/persona");
export const putPersona = (p: Persona) => put<Persona>("/api/cockpit/persona", p);
export const getRecommendations = (refresh = false) => get<Recommendations>(`/api/cockpit/recommendations${refresh ? "?refresh=true" : ""}`);
export const postPos = (operator: string, lines: PostLine[]) => post<PostResult[]>("/api/cockpit/post-pos", { operator, lines });
export const getOpenPos = () => get<OpenPo[]>("/api/cockpit/open-pos");
export const getPoHistory = () => get<PoHistoryRow[]>("/api/cockpit/po-history");
export const getPurchaseHistory = () => get<{ entries: PurchaseEntry[] }>("/api/purchase-history");
export const getProjection = (item: string, withRecommendations = false) =>
  get<Projection>(`/api/plan/projection/${encodeURIComponent(item)}?with_recommendations=${withRecommendations}`);
