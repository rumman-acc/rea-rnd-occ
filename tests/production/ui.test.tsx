import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapacityPage } from "@/features/capacity/CapacityPage";
import { CostingPage } from "@/features/costing/CostingPage";
import { GanttPage } from "@/features/gantt/GanttPage";
import { ordersCsv, linkageCsv, coverageStatus } from "@/features/production/csv";
import { ProductionPage } from "@/features/production/ProductionPage";
import { createHttpPlanProvider } from "@/lib/api/planProvider";
import { renderApp } from "../helpers";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const show = (ui: React.ReactElement) => renderApp({ provider: createHttpPlanProvider(), ui });
const bodyRows = (name: string) => within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);

describe("/production", () => {
  it("lists released orders sorted by end date with the original subline", async () => {
    show(<ProductionPage />);
    expect(await screen.findByRole("heading", { name: "Production Orders" })).toBeInTheDocument();
    expect((await screen.findAllByText("P-ORD201004")).length).toBeGreaterThan(0);
    expect(screen.getByText("3 released orders (3 linked to SOs) · 12.8 units remaining")).toBeInTheDocument();
    const pos = Array.from(document.querySelectorAll("table.prd-table tbody tr td:first-child")).map((e) => e.textContent);
    expect(pos.slice(0, 3)).toEqual(["P-ORD201004", "P-ORD201001", "P-ORD201002"]);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gantt & Simulate/ })).toHaveAttribute("href", "/gantt");
  });

  it("filters on raw values and sorts", async () => {
    const user = userEvent.setup();
    show(<ProductionPage />);
    await screen.findAllByText("P-ORD201004");
    await user.type(screen.getByLabelText("Filter Health"), "yellow");
    const rows = document.querySelectorAll("table.prd-table tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("P-ORD201004");
  });

  it("linkage tab shows counts and Coverage Intelligence", async () => {
    const user = userEvent.setup();
    show(<ProductionPage />);
    await screen.findAllByText("P-ORD201004");
    await user.click(screen.getByRole("tab", { name: /SO ↔ PO Linkage/ }));
    expect(await screen.findByText("Coverage Intelligence", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("$12,100 uncovered")).toBeInTheDocument();
    const first = document.querySelector("table.prd-table tbody tr")!;
    expect(first.textContent).toContain("No PO");
    expect(screen.getAllByText("-5d")).toHaveLength(3);
    expect(screen.getAllByText("+2d").length).toBeGreaterThan(0);
    expect(screen.getByText("1:1 coverage via BC reservation entries · buffer = SO delivery − PO end")).toBeInTheDocument();
  });

  it("release and finish through the demo actions update the store and the list", async () => {
    const user = userEvent.setup();
    show(<ProductionPage />);
    await screen.findAllByText("P-ORD201004");
    const actions = await screen.findByRole("table", { name: "Order actions" });
    const row = within(actions).getByText("P-ORD201003").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText("4 released orders (4 linked to SOs) · 20.8 units remaining")).toBeInTheDocument());
    const row2 = within(screen.getByRole("table", { name: "Order actions" })).getByText("P-ORD201003").closest("tr")!;
    await user.click(within(row2).getByRole("button", { name: "Mark finished" }));
    await waitFor(() => expect(screen.getByText(/^3 released orders/)).toBeInTheDocument());
    expect(bodyRows("Order actions").map((r) => r.textContent).join()).not.toContain("P-ORD201003");
  });

  it("csv helpers use the original headers and statuses", () => {
    const rows = [{ po_number: "P1", so_number: null, customer_name: 'A "B"', item_no: "I", series: "1", model: "M", start_date: "2026-01-01", end_date: "2026-01-02", quantity: 2, pct_complete: 5, delivery_date: null, health: null, linked: false }];
    expect(ordersCsv(rows)[0]).toBe("PO#,Customer,Item,Series,Model,Start,End,Remaining,ProgressPct,Linked,SODue,Health");
    expect(ordersCsv(rows)[1]).toBe('P1,"A ""B""",I,1,"M",2026-01-01,2026-01-02,2,5,no,,');
    expect(linkageCsv([])[0]).toBe("SO#,Customer,Series,Model,SODelivery,OpenQty,LinkedPO,POEnd,BufferDays,Status");
    const base = { so_number: "S", item_no: "1", customer_name: null, series: null, model: "", delivery_date: null, quantity: 1, unit_price: 1, health: "red" as const, prod_order_no: "P", prod_start: null, prod_end: null, prod_pct_complete: 0 };
    expect([coverageStatus({ ...base, buffer_days: -1 }), coverageStatus({ ...base, buffer_days: 6 }), coverageStatus({ ...base, buffer_days: 7 }), coverageStatus({ ...base, buffer_days: null }), coverageStatus({ ...base, prod_order_no: null, buffer_days: null })]).toEqual(["late", "tight", "ok", "ok", "no-po"]);
  });
});

describe("/capacity", () => {
  it("shows the notice, the load matrix and switches granularity", async () => {
    const user = userEvent.setup();
    show(<CapacityPage />);
    expect(await screen.findByRole("heading", { name: "Capacity" })).toBeInTheDocument();
    expect(screen.getByText(/no original reference/)).toBeInTheDocument();
    const matrix = await screen.findByRole("table", { name: "Capacity load" });
    expect(within(matrix).getAllByRole("columnheader")).toHaveLength(13);
    expect(matrix.querySelector('[data-status="over"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Capacity load" })).getAllByRole("columnheader")).toHaveLength(7));
    expect(screen.getByText("Oct 26")).toBeInTheDocument();
  });

  it("runs a scenario without saving, then applies headcounts for real", async () => {
    const user = userEvent.setup();
    show(<CapacityPage />);
    await screen.findByRole("table", { name: "Capacity load" });
    await user.click(screen.getByRole("tab", { name: "Scenario" }));
    const hc = await screen.findByLabelText(/Assembly headcount/);
    await user.clear(hc);
    await user.type(hc, "4");
    await user.click(screen.getByRole("button", { name: "Run scenario" }));
    const delta = await screen.findByTestId("scenario-delta");
    expect(screen.getByText("Scenario — nothing is saved.")).toBeInTheDocument();
    const nums = within(delta).getAllByText(/^\d+$/).map((e) => Number(e.textContent));
    expect(nums[1]).toBeLessThan(nums[0]);
    expect((await api.call("GET", "/api/workcenters")).body.find((w: { code: string }) => w.code === "WC-ASM").headcount).toBe(2);
    await user.click(screen.getByRole("button", { name: "Apply headcounts" }));
    expect(await screen.findByText("Headcounts saved.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/workcenters")).body.find((w: { code: string }) => w.code === "WC-ASM").headcount).toBe(4);
  });

  it("adds and deletes an adjustment on the setup tab and shows server errors", async () => {
    const user = userEvent.setup();
    show(<CapacityPage />);
    await screen.findByRole("table", { name: "Capacity load" });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await screen.findByRole("table", { name: "Routing times" });
    await user.click(screen.getByRole("button", { name: "Add adjustment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/start_date/);
    await user.type(screen.getByLabelText("Adjustment from"), "2026-10-19");
    await user.type(screen.getByLabelText("Adjustment to"), "2026-10-23");
    await user.clear(screen.getByLabelText("Adjustment hours"));
    await user.type(screen.getByLabelText("Adjustment hours"), "-8");
    await user.click(screen.getByRole("button", { name: "Add adjustment" }));
    expect(await screen.findByText("Adjustment added.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Delete adjustment 1" }));
    expect(await screen.findByText("Adjustment deleted.")).toBeInTheDocument();
  });

  it("saves routing times", async () => {
    const user = userEvent.setup();
    show(<CapacityPage />);
    await screen.findByRole("table", { name: "Capacity load" });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    const cell = await screen.findByLabelText("FG-1000 WC-ASM hours");
    await user.clear(cell);
    await user.type(cell, "9");
    await user.click(screen.getByRole("button", { name: "Save routing times" }));
    expect(await screen.findByText("Routing times saved.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/capacity/routing-times")).body.models["FG-1000"]["WC-ASM"]).toBe(9);
  });
});

describe("/costing", () => {
  it("shows the roll-up and expands a breakdown", async () => {
    const user = userEvent.setup();
    show(<CostingPage />);
    expect(await screen.findByRole("heading", { name: "Product Costing" })).toBeInTheDocument();
    expect(screen.getByText(/no original reference/)).toBeInTheDocument();
    const row = (await screen.findByText("FG-1000")).closest("tr")!;
    expect(row.textContent).toContain("$555.02");
    expect(row.textContent).toContain("19%");
    await user.click(row);
    expect(screen.getByRole("table", { name: "Material breakdown FG-1000" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Labor breakdown FG-1000" })).toBeInTheDocument();
  });

  it("saving a labor rate recalculates; invalid rate shows the server message", async () => {
    const user = userEvent.setup();
    show(<CostingPage />);
    await screen.findByText("FG-1000");
    const asm = await screen.findByLabelText("Assembly ($/h)");
    await user.clear(asm);
    await user.type(asm, "-3");
    await user.click(screen.getByRole("button", { name: "Save rates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rates\.WC-ASM/);
    await user.clear(asm);
    await user.type(asm, "34");
    await user.click(screen.getByRole("button", { name: "Save rates" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("FG-1000").closest("tr")!.textContent).toContain("$476.00"));
  });
});

describe("/gantt", () => {
  it("renders the timeline with the reconstruction notice", async () => {
    show(<GanttPage />);
    expect(await screen.findByRole("heading", { name: "Schedule & Simulate" })).toBeInTheDocument();
    expect(screen.getByText(/no original reference/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Bar P-ORD201001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bar P-ORD201006" })).toBeInTheDocument();
  });

  it("rescheduling in simulation mode moves the KPIs and saves nothing", async () => {
    const user = userEvent.setup();
    show(<GanttPage />);
    await user.click(await screen.findByRole("button", { name: "Bar P-ORD201001" }));
    expect(screen.getByLabelText("End date")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Start simulation/ }));
    await waitFor(() => expect(screen.getByLabelText("End date")).toBeEnabled());
    const end = screen.getByLabelText("End date");
    await user.clear(end);
    await user.type(end, "2026-10-20");
    await user.click(screen.getByRole("button", { name: "Apply reschedule" }));
    const impact = screen.getByRole("table", { name: "Impact" });
    await waitFor(() => expect(within(impact).getByText("67%")).toBeInTheDocument());
    expect(within(impact).getByText("50%")).toBeInTheDocument();
    const orders = (await api.call("GET", "/api/production/orders")).body;
    expect(orders.find((o: { po_number: string }) => o.po_number === "P-ORD201001").end_date).toBe("2026-10-27");
  });

  it("adds a simulated order and applies it to real data after confirmation", async () => {
    const user = userEvent.setup();
    show(<GanttPage />);
    await screen.findByRole("button", { name: "Bar P-ORD201001" });
    await user.click(screen.getByRole("button", { name: /Start simulation/ }));
    await user.selectOptions(await screen.findByLabelText("New order item"), "FG-3000");
    await user.selectOptions(screen.getByLabelText("New order sales order"), "S-ORD101007");
    await user.type(screen.getByLabelText("New order start"), "2026-10-20");
    await user.type(screen.getByLabelText("New order end"), "2026-11-10");
    await user.click(screen.getByRole("button", { name: /Add order SIM-1/ }));
    expect(await screen.findByRole("button", { name: "Bar SIM-1" })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Impact" })).getByText("88%")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Apply to production orders" }));
    await user.click(screen.getByRole("button", { name: "Confirm apply" }));
    expect(await screen.findByText("Applied 1 change(s) to production orders.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/plan")).body.kpis.linked_pct).toBe(88);
    expect(await screen.findByRole("button", { name: "Bar P-ORD201007" })).toBeInTheDocument();
  });

  it("validates dates in the new order form before calling the server", async () => {
    const user = userEvent.setup();
    show(<GanttPage />);
    await screen.findByRole("button", { name: "Bar P-ORD201001" });
    await user.click(screen.getByRole("button", { name: /Start simulation/ }));
    await user.click(await screen.findByRole("button", { name: /Add order SIM-1/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/required/);
  });
});
