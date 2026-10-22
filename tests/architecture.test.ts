import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoProvider } from "@/data/demoProvider";
import { FX_KPI, FX_PLAN, FX_ROWS } from "@/data/fixtures";
import { renderLoaded } from "./helpers";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const srcFiles = walk(SRC);
const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");
const read = (p: string) => readFileSync(p, "utf8");
const css = read(join(SRC, "app", "globals.css"));

describe("AC-021 determinism and the demo provider (ARC-005)", () => {
  it("returns equal but distinct objects on successive calls", async () => {
    const p = createDemoProvider();
    const a = await p.getPlan({ refresh: false });
    const b = await p.getPlan({ refresh: false });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.status_board).not.toBe(b.status_board);

    a.kpis.open_so_lines = 12345;
    a.status_board.pop();
    const c = await p.getPlan({ refresh: false });
    expect(c.kpis.open_so_lines).toBe(8);
    expect(c.status_board).toHaveLength(8);
  });

  it("refresh has no effect on the data", async () => {
    const p = createDemoProvider();
    expect(await p.getPlan({ refresh: true })).toEqual(await p.getPlan({ refresh: false }));
  });

  it("never mutates the frozen fixtures", async () => {
    const p = createDemoProvider();
    const plan = await p.getPlan({ refresh: false });
    plan.status_board[0].quantity = 999;
    expect(FX_ROWS[0].quantity).toBe(10);
    expect(Object.isFrozen(FX_PLAN)).toBe(true);
    expect(Object.isFrozen(FX_KPI)).toBe(true);
  });

  it("provider source does no I/O and reads no clock or randomness", () => {
    const src = read(join(SRC, "data", "demoProvider.ts")) + read(join(SRC, "data", "fixtures.ts"));
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|Date\.now|new Date\(|Math\.random|performance\.now/);
  });

  it("two renders under the fixed configuration produce identical output", async () => {
    const first = await renderLoaded();
    const html1 = first.container.innerHTML;
    first.unmount();
    const second = await renderLoaded();
    expect(second.container.innerHTML).toBe(html1);
  });
});

describe("AC-020 provider and layer boundaries (ARC-003, SPEC-FULL ARC-F05)", () => {
  const clientFiles = srcFiles.filter((f) => /src[\\/](components|state|features|lib|data|domain)[\\/]/.test(f));
  const uiFiles = srcFiles.filter((f) => /src[\\/](components|state|features)[\\/]/.test(f));

  it("no component, state or feature module imports fixtures, the demo provider or test support", () => {
    for (const f of uiFiles) {
      expect(read(f), rel(f)).not.toMatch(/data\/fixtures|data\/demoProvider|testing\/providers/);
    }
  });

  it("client code never imports server code", () => {
    for (const f of clientFiles) expect(read(f), rel(f)).not.toMatch(/from ["']@\/server/);
  });

  it("fetch is called in exactly one place: the request boundary", () => {
    const callers = srcFiles.filter((f) => /\bfetch\s*\(/.test(read(f))).map(rel);
    expect(callers).toEqual(["src/lib/api/request.ts"]);
  });

  it("the demo provider is never wired into the app; the HTTP provider only in the composition root", () => {
    const demo = srcFiles.filter((f) => /createDemoProvider/.test(read(f))).map(rel);
    expect(demo).toEqual(["src/data/demoProvider.ts"]);
    const http = srcFiles.filter((f) => /createHttpPlanProvider/.test(read(f))).map(rel).sort();
    expect(http).toEqual(["src/app/providers.tsx", "src/lib/api/planProvider.ts"]);
  });
});

describe("API surface (SPEC-FULL ARC-F03)", () => {
  const routeFiles = srcFiles.filter((f) => /[\\/]app[\\/]api[\\/].*route\.ts$/.test(f));

  it("every route handler goes through handle()", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const f of routeFiles) expect(read(f), rel(f)).toMatch(/\bhandle\s*[(<]/);
  });

  it("no route imports client code", () => {
    for (const f of routeFiles) expect(read(f), rel(f)).not.toMatch(/@\/(components|state)\//);
  });
});

describe("AC-019 clean room (FR-008)", () => {
  it("does not reproduce original-site assets or backend wording", () => {
    expect(existsSync(join(ROOT, "public"))).toBe(false);
    const all = srcFiles.map(read).join("\n");
    expect(all).not.toMatch(/fluid-logo|FastAPI|port 8000|webpackChunk/i);
  });

  it("has no auth dependency", () => {
    const pkg = JSON.parse(read(join(ROOT, "package.json")));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /next-auth|@auth\//.test(d))).toEqual([]);
  });

  it("brand names are configuration, not literals in components", () => {
    const comps = srcFiles.filter((f) => /src[\\/]components[\\/]/.test(f));
    for (const f of comps) expect(read(f), rel(f)).not.toMatch(/Acme|Fluid Industries/);
  });
});

describe("AC-015 / AC-018 layout rules (TBL-007, KPI-016, NF-005)", () => {
  const block = (selector: string) => {
    const m = new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : "";
  };

  it("table container: max height 340px and scrolls; header is sticky", () => {
    expect(block(".card__body--table")).toMatch(/max-height:\s*340px/);
    expect(block(".card__body--table")).toMatch(/overflow:\s*auto/);
    expect(block(".orders thead th")).toMatch(/position:\s*sticky/);
  });

  it("KPI grid is 2 / 3 / 6 columns", () => {
    expect(block(".kpi-grid")).toMatch(/repeat\(2,/);
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.kpi-grid\s*\{[^}]*repeat\(3,/);
    expect(css).toMatch(/@media \(min-width: 1280px\)\s*\{\s*\.kpi-grid\s*\{[^}]*repeat\(6,/);
  });

  it("chart cards stack below lg; table and supply stack below xl", () => {
    expect(block(".chart-grid")).toMatch(/minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\.chart-grid\s*\{[^}]*repeat\(2,/);
    expect(css).toMatch(/@media \(min-width: 1280px\)\s*\{\s*\.bottom-grid\s*\{[^}]*1\.5fr 1fr/);
  });

  it("shell dimensions: 230px / 60px sidebar, 54px header, 20px main padding", () => {
    expect(block(".sidebar")).toMatch(/width:\s*230px/);
    expect(block(".sidebar--collapsed")).toMatch(/width:\s*60px/);
    expect(block(".header")).toMatch(/height:\s*54px/);
    expect(block(".shell__main")).toMatch(/padding:\s*20px/);
    expect(block(".chart")).toMatch(/height:\s*220px/);
  });
});
