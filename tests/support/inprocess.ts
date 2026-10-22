import { setClock } from "@/server/clock";
import { createMemoryStore, setStore, type Store } from "@/server/store";
import { setTransport, setUnauthorizedHandler, type Transport } from "@/lib/api/request";

/**
 * In-process API for tests: routes `request()` calls straight into the real route handlers
 * under src/app/api, backed by a memory store. No server, no network, no cookies needed.
 *
 *   const api = installApi();          // in beforeEach
 *   ...render a page, or call api.call("GET", "/api/plan")
 *   api.uninstall();                    // in afterEach
 */

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Loader = () => Promise<Record<string, unknown>>;

const loaders = import.meta.glob("/src/app/api/**/route.ts") as Record<string, Loader>;

interface Route {
  pattern: RegExp;
  names: string[];
  score: number;
  load: Loader;
}

function compile(file: string, load: Loader): Route {
  const segs = file.replace("/src/app/api", "").replace(/\/route\.ts$/, "").split("/").filter(Boolean);
  const names: string[] = [];
  let score = 0;
  const parts = segs.map((s) => {
    const catchAll = /^\[\.\.\.(\w+)\]$/.exec(s);
    if (catchAll) {
      names.push(catchAll[1]);
      return "(.+)";
    }
    const dyn = /^\[(\w+)\]$/.exec(s);
    if (dyn) {
      names.push(dyn[1]);
      return "([^/]+)";
    }
    score += 1;
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return { pattern: new RegExp(`^/api${parts.length ? "/" + parts.join("/") : ""}$`), names, score, load };
}

const routes: Route[] = Object.entries(loaders)
  .map(([f, l]) => compile(f, l))
  .sort((a, b) => b.score - a.score);

export function createInProcessTransport(): Transport {
  return async (path, init) => {
    const url = new URL(path, "http://localhost");
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      const mod = await r.load();
      const method = (init.method ?? "GET").toUpperCase();
      const handler = mod[method] as Handler | undefined;
      if (!handler) return new Response(JSON.stringify({ detail: "Method not allowed" }), { status: 405 });
      const req = new Request(url, { method, headers: init.headers, body: method === "GET" || method === "HEAD" ? undefined : (init.body as BodyInit | undefined) });
      return handler(req, { params: Promise.resolve(params) });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404, statusText: "Not Found" });
  };
}

export interface InstalledApi {
  store: Store;
  /** Direct call without the page layer, returning parsed JSON and the status. */
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  uninstall: () => void;
}

export function installApi(opts: { store?: Store; now?: string } = {}): InstalledApi {
  const store = opts.store ?? createMemoryStore();
  setStore(store);
  setClock(() => new Date(opts.now ?? "2026-10-19T19:11:44Z"));
  const transport = createInProcessTransport();
  setTransport(transport);
  setUnauthorizedHandler(undefined);
  return {
    store,
    async call(method, path, body) {
      const res = await transport(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // leave as text
      }
      return { status: res.status, body: parsed };
    },
    uninstall() {
      setStore(undefined);
      setClock(undefined);
      setTransport(undefined);
    },
  };
}
