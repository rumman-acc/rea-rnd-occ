import { getSessionUser } from "./auth";
import { getStore, type Store } from "./store";

// Route-handler helpers shared by every module (SPEC-FULL ARC-F03).

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Not authenticated") => new HttpError(401, m);
export const forbidden = (m = "Forbidden") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export interface Ctx<P extends Record<string, string> = Record<string, string>> {
  req: Request;
  store: Store;
  params: P;
  url: URL;
  /** Signed-in user's display name, or "demo" when the request has no session (e.g. in-process tests). */
  actor: string;
  /** Parse the JSON body; throws 400 on invalid JSON. Empty body gives {}. */
  json<T = Record<string, unknown>>(): Promise<T>;
}

type NextCtx = { params?: Promise<Record<string, string>> | Record<string, string> };

/**
 * Wrap a handler. Errors become `{ "detail": message }` with the right status
 * (the shape the original client's error text assumed). Return value is sent as JSON.
 */
export function handle<P extends Record<string, string> = Record<string, string>>(
  fn: (c: Ctx<P>) => unknown | Promise<unknown>,
): (req: Request, ctx?: NextCtx) => Promise<Response> {
  return async (req, nextCtx) => {
    try {
      const params = ((await nextCtx?.params) ?? {}) as P;
      const user = getSessionUser(req);
      const c: Ctx<P> = {
        req,
        store: getStore(),
        params,
        url: new URL(req.url),
        actor: user?.name ?? "demo",
        async json<T>() {
          const text = await req.text();
          if (!text.trim()) return {} as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw badRequest("Invalid JSON body");
          }
        },
      };
      const result = await fn(c);
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ detail: e.message }, { status: e.status });
      const message = e instanceof Error ? e.message : String(e);
      return Response.json({ detail: message }, { status: 500 });
    }
  };
}

/** Read a positive-integer or default query parameter. */
export function intParam(url: URL, name: string, fallback: number): number {
  const v = Number(url.searchParams.get(name));
  return Number.isFinite(v) && url.searchParams.has(name) ? v : fallback;
}
