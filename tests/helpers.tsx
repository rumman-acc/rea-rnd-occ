import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { Dashboard } from "@/components/Dashboard";
import { Shell } from "@/components/Shell";
import { createDemoProvider } from "@/data/demoProvider";
import { FX_PLAN } from "@/data/fixtures";
import { DataProvider, type PlanProvider } from "@/data/provider";
import type { Kpis, Plan, StatusRow } from "@/domain/types";
import { RuntimeProvider, type Runtime } from "@/runtime/runtime";
import { PlanStateProvider } from "@/state/PlanState";
import { SessionProvider } from "@/state/Session";

/** Fixed test configuration (SPEC ARC-008): 2026-10-19, en-US, explicit UTC. */
export const testRuntime = (now = "2026-10-19T12:00:00Z"): Runtime => ({
  now: () => new Date(now),
  locale: "en-US",
  timeZone: "UTC",
});

export const clonePlan = (): Plan => structuredClone(FX_PLAN) as Plan;

export function planWith(change: { kpis?: Partial<Kpis>; rows?: StatusRow[] }): Plan {
  const p = clonePlan();
  if (change.kpis) p.kpis = { ...p.kpis, ...change.kpis };
  if (change.rows) p.status_board = change.rows;
  return p;
}

/** Signed-in fixture user for UI tests (initials render as "AM"). */
export const testUser = { id: "u-admin", name: "Alex Morgan", email: "alex.morgan@example.com", role: "Admin" };

export function renderApp(
  opts: { provider?: PlanProvider; runtime?: Runtime; ui?: ReactElement; user?: typeof testUser | null; onSignedOut?: () => void } = {},
) {
  const provider = opts.provider ?? createDemoProvider();
  return {
    provider,
    ...render(
      <RuntimeProvider value={opts.runtime ?? testRuntime()}>
        <SessionProvider initialUser={opts.user === undefined ? testUser : opts.user} onSignedOut={opts.onSignedOut ?? (() => {})}>
          <DataProvider provider={provider}>
            <PlanStateProvider>
              <Shell>{opts.ui ?? <Dashboard />}</Shell>
            </PlanStateProvider>
          </DataProvider>
        </SessionProvider>
      </RuntimeProvider>,
    ),
  };
}

/** Render and wait for the dashboard content to appear. */
export async function renderLoaded(opts: Parameters<typeof renderApp>[0] = {}) {
  const r = renderApp(opts);
  await screen.findByRole("heading", { name: "Operations Dashboard" });
  return r;
}

export function tableEl(): HTMLElement {
  return screen.getByRole("table");
}

/** SO numbers of the rendered body rows, in displayed order. */
export function soNumbers(): string[] {
  const body = tableEl().querySelector("tbody")!;
  return within(body)
    .queryAllByRole("row")
    .map((tr) => tr.querySelector("td")?.textContent ?? "")
    .filter((t) => t.startsWith("S-ORD"));
}

export function chartConfig(testId: "chart-doughnut" | "chart-bar") {
  return JSON.parse(screen.getByTestId(testId).getAttribute("data-config")!) as {
    data: { labels: string[]; datasets: { data: number[]; label?: string; backgroundColor: unknown }[] };
    options: Record<string, unknown>;
  };
}

export { waitFor };
