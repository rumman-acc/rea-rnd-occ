import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCsv, Sop } from "@/features/sop/Sop";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

async function open() {
  renderApp({ ui: <Sop /> });
  await screen.findByRole("heading", { name: "S&OP Planning" });
}

describe("S&OP page", () => {
  it("renders sections, month columns, rows and gaps", async () => {
    await open();
    expect(screen.getByText("Demand & Production Plan")).toBeInTheDocument();
    expect(screen.getByText("Total Demand vs Plan by Month (units)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "S&OP Intelligence" })).toBeInTheDocument();
    const head = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual(["Series / Row", "Oct 26", "Nov 26", "Dec 26", "Jan 27", "Feb 27", "Mar 27", "6M Total"]);
    expect(screen.getByText("1000 STD")).toBeInTheDocument();
    expect(screen.getByText("1000-series")).toBeInTheDocument();
    expect(screen.getByText(/shortfall of 8 units/)).toBeInTheDocument();
  });

  it("feeds the chart with demand and plan totals per month", async () => {
    await open();
    const cfg = JSON.parse(screen.getByTestId("chart-bar").getAttribute("data-config")!);
    expect(cfg.data.labels[0]).toBe("Oct 26");
    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual(["Demand", "Plan (scheduled+firm+flex)"]);
    expect(cfg.data.datasets[0].data).toEqual([35, 10, 0, 0, 0, 0]);
    expect(cfg.data.datasets[1].data).toEqual([27, 16, 0, 0, 0, 0]);
  });

  it("filters by series", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "3000" }));
    expect(screen.queryByText("1000 STD")).not.toBeInTheDocument();
    expect(screen.getByText("3000 STD")).toBeInTheDocument();
    expect(screen.getByText(/planning grain: routing model \(1 row\)/)).toBeInTheDocument();
  });

  it("edits a plan cell, saves, and the intelligence panel updates", async () => {
    const user = userEvent.setup();
    await open();
    const save = screen.getByRole("button", { name: /Save Plan/ });
    expect(save).toBeDisabled();
    const cell = screen.getByLabelText("Firm Plan 1000 STD Oct 26");
    await user.type(cell, "8");
    expect(screen.getByRole("button", { name: "Save Plan (1)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save Plan (1)" }));
    expect(await screen.findByText("Plan saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Plan" })).toBeDisabled());
    expect(screen.queryByText(/Model 1000 STD: shortfall/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Firm Plan 1000 STD Oct 26")).toHaveValue(8);
    const b = (await api.call("GET", "/api/sop")).body;
    expect(b.rows[0].cells[0].firm).toBe(8);
  });

  it("shows the server's validation error on save", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByLabelText("Flex Plan 1000 STD Oct 26"), "5");
    // a stale window: move the server clock so the edited month is out of range
    api.uninstall();
    api = installApi({ now: "2027-06-01T00:00:00Z" });
    await user.click(screen.getByRole("button", { name: "Save Plan (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/outside the planning window/);
  });

  it("Add Model creates a plan-only row that persists once a quantity is saved", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("5000 1h");
    await open();
    await user.click(screen.getByRole("button", { name: /Add Model/ }));
    expect(screen.getByText("5000 1H")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Firm Plan 5000 1H Nov 26"), "3");
    await user.click(screen.getByRole("button", { name: "Save Plan (1)" }));
    await screen.findByText("Plan saved");
    expect(screen.getByText("5000 1H")).toBeInTheDocument();
  });

  it("Reset clears all overrides after confirmation", async () => {
    const user = userEvent.setup();
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-10": { firm: 8 } } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await open();
    expect(screen.getByLabelText("Firm Plan 1000 STD Oct 26")).toHaveValue(8);
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Firm Plan 1000 STD Oct 26")).toHaveValue(null));
    expect((await api.call("GET", "/api/sop")).body.rows[0].cells[0].firm).toBe(0);
  });

  it("expands the finished-good sheet and saves an item-level plan", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Show finished goods for 1000 STD" }));
    expect(screen.getByText("FG-1000")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Firm Plan 1000 STD|FG-1000 Dec 26"), "4");
    await user.click(screen.getByRole("button", { name: "Save Plan (1)" }));
    await screen.findByText("Plan saved");
    expect(screen.getByText("1 item plan")).toBeInTheDocument();
  });

  it("exports CSV rows", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await open();
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(click).toHaveBeenCalled();
    const lines = buildCsv((await api.call("GET", "/api/sop")).body);
    expect(lines[0]).toBe("Model,Series,Month,Demand,Scheduled,FirmPlan,FlexPlan,Gap");
    expect(lines[1]).toBe('"1000 STD",1000,2026-10,23,15,0,0,-8');
    expect(lines).toHaveLength(1 + 4 * 6);
  });

  it("shows an error when loading fails", async () => {
    api.uninstall();
    const { setTransport } = await import("@/lib/api/request");
    setTransport(async () => new Response('{"detail":"boom"}', { status: 500, statusText: "Server Error" }));
    renderApp({ ui: <Sop /> });
    expect(await screen.findByRole("alert")).toHaveTextContent("500 Server Error");
    setTransport(undefined);
    api = installApi();
  });
});
