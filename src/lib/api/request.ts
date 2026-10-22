/**
 * The ONE place the browser talks HTTP (SPEC-FULL ARC-F05). Every feature's api.ts calls
 * `request`; nothing else in src/ may call fetch. Tests replace the transport with
 * an in-process router (tests/support/inprocess.ts) so pages run against the real handlers.
 */

export type Transport = (path: string, init: RequestInit) => Promise<Response>;

const fetchTransport: Transport = (path, init) => fetch(path, { credentials: "same-origin", ...init });

let transport: Transport = fetchTransport;

export function setTransport(t: Transport | undefined): void {
  transport = t ?? fetchTransport;
}

/** Called when a protected request comes back 401 in a browser. Replaceable for tests. */
let onUnauthorized: () => void = () => {
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
};

export function setUnauthorizedHandler(fn: (() => void) | undefined): void {
  onUnauthorized = fn ?? (() => {});
}

export async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await transport(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized();
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
export const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** Build a query string, skipping undefined/null/empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
