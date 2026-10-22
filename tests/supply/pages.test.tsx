import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoProvider } from "@/data/demoProvider";
import { Replenishment } from "@/features/replenishment/Replenishment";
import { nettingRows, supplyCsv } from "@/features/supply/netting";
import { SupplyExplorer } from "@/features/supply/SupplyExplorer";
import { updateMaster } from "@/server/master";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => {
  api.uninstall();
  window.history.replaceState(null, "", "/");
});

const rowOf = (item: string) => screen.getAllByRole("row").find((r) => within(r).queryAllByText(item).length > 0 && r.querySelector("td"))!;

describe("Supply Explorer", () => {
  it("shows order list, header card and netting table for the first order", async () => {
    renderApp({ ui: <SupplyExplorer /> });
    await screen.findByRole("heading", { name: "Supply Explorer" });
    const order = await screen.findByLabelText("Order");
    await waitFor(() => expect(within(order).getAllByRole("option").length).toBe(9));
    const first = within(order).getAllByRole("option")[0].textContent!;
    expect(first).toContain("S&OP PLAN 2026-12 · FG-6000 · 1 units planned");
    await userEvent.selectOptions(order, "S-ORD101001");
    await screen.findByText("Material netting for SO S-ORD101001 (BOM order)");
    expect(screen.getByText("Prod Order P-ORD201001")).toBeInTheDocument();
    expect(screen.getByText("1000-series")).toBeInTheDocument();
    // status dots arrive from /api/supply-status
    await waitFor(() => expect(order.textContent).toContain("🔴"));
    const a = rowOf("CMP-A");
    expect(within(a).getByText("Shortfall")).toBeInTheDocument();
    expect(within(rowOf("CMP-B")).getByText("Sufficient")).toBeInTheDocument();
  });

  it("filters by FG and toggles WITH recommended POs", async () => {
    renderApp({ ui: <SupplyExplorer /> });
    const fg = await screen.findByLabelText("FG");
    await waitFor(() => expect(within(fg).getAllByRole("option").length).toBe(5));
    await userEvent.selectOptions(fg, "FG-6000");
    const order = screen.getByLabelText("Order");
    expect(within(order).getAllByRole("option")).toHaveLength(2);
    await userEvent.selectOptions(order, "S-ORD101004");
    await screen.findByText("Material netting for SO S-ORD101004 (BOM order)");
    expect(screen.getByText("Sub-assembly · manufactured")).toBeInTheDocument();
    expect(screen.getByText("produced in-house — components below")).toBeInTheDocument();
    await userEvent.selectOptions(fg, "FG-3000");
    await userEvent.selectOptions(screen.getByLabelText("Order"), "S-ORD101003");
    await screen.findByText("Material netting for SO S-ORD101003 (BOM order)");
    const e = rowOf("CMP-E");
    expect(within(e).getByText("Shortfall")).toBeInTheDocument();
    expect(within(e).getAllByText("-3")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "WITHOUT recommended POs" }));
    expect(screen.getByRole("button", { name: "WITH recommended POs" })).toBeInTheDocument();
    expect(within(rowOf("CMP-E")).getByText("+2")).toBeInTheDocument();
    expect(within(rowOf("CMP-E")).getByText("Shortfall")).toBeInTheDocument();
  });

  it("opens the projection chart and filters rows", async () => {
    renderApp({ ui: <SupplyExplorer /> });
    await userEvent.selectOptions(await screen.findByLabelText("Order"), "S-ORD101001");
    await screen.findByText("Material netting for SO S-ORD101001 (BOM order)");
    await userEvent.click(screen.getByRole("button", { name: "Chart CMP-A" }));
    expect(screen.getByRole("img", { name: "Inventory projection for CMP-A" })).toBeInTheDocument();
    expect(screen.getByText(/STOCKOUT/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Filter Status"), "shortfall");
    expect(screen.queryByText("CMP-B")).not.toBeInTheDocument();
    expect(screen.getByText("CMP-A")).toBeInTheDocument();
  });

  it("Create PO opens the modal, submits, shows the PO number and refreshes the plan", async () => {
    const provider = createDemoProvider();
    const spy = vi.spyOn(provider, "getPlan");
    renderApp({ provider, ui: <SupplyExplorer /> });
    await userEvent.selectOptions(await screen.findByLabelText("Order"), "S-ORD101001");
    await screen.findByText("Material netting for SO S-ORD101001 (BOM order)");
    await userEvent.click(within(rowOf("CMP-A")).getByRole("button", { name: /Create PO/ }));
    const dlg = await screen.findByRole("dialog", { name: "Create Purchase Order — CMP-A" });
    // The purchasing module now serves /api/buy-recommendation, so the modal gets a recommendation.
    await waitFor(() => expect(within(dlg).queryByText(/Computing recommendation/)).not.toBeInTheDocument());
    expect(within(dlg).queryByText(/Recommendation service unavailable/)).not.toBeInTheDocument();
    const submit = within(dlg).getByRole("button", { name: "Submit Purchase Order" });
    expect(submit).toBeDisabled();
    const qty = within(dlg).getByLabelText(/Order Quantity/);
    expect(Number((qty as HTMLInputElement).value)).toBeGreaterThan(0);
    await userEvent.clear(qty);
    await userEvent.type(qty, "15");
    await userEvent.click(within(dlg).getByRole("checkbox"));
    await userEvent.click(submit);
    await within(dlg).findByText("Purchase Order created successfully");
    expect(within(dlg).getByText("V-PO-D9001")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ refresh: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const po = await api.call("GET", "/api/supply-detail/FG-1000");
    expect(po.body.components.find((c: { item_no: string }) => c.item_no === "CMP-A").on_po).toBe(30);
  });

  it("shows the server error when the push fails", async () => {
    renderApp({ ui: <SupplyExplorer /> });
    await userEvent.selectOptions(await screen.findByLabelText("Order"), "S-ORD101001");
    await screen.findByText("Material netting for SO S-ORD101001 (BOM order)");
    await userEvent.click(within(rowOf("CMP-A")).getByRole("button", { name: /Create PO/ }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.clear(within(dlg).getByLabelText(/^Vendor No/));
    await userEvent.type(within(dlg).getByLabelText(/^Vendor No/), "ZZ");
    await userEvent.click(within(dlg).getByRole("checkbox"));
    await userEvent.click(within(dlg).getByRole("button", { name: "Submit Purchase Order" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(/Unknown vendor/);
  });

  it("builds the CSV with the documented header", () => {
    const rows = nettingRows(
      [{ item_no: "X", description: "Part", level: 1, is_subassembly: false, extended_qty: 2 }],
      3,
      { X: { item_no: "X", description: "Part", opening_inventory: 4, min_balance: -2, first_stockout_date: "2026-11-01", events: [{ on_date: "2026-11-01", kind: "demand", delta: -6, balance_after: -2, reference: "S" }] } },
    );
    expect(supplyCsv("SO1", rows)).toEqual([
      "SO,Component,Description,Level,SubAssembly,Required,OpeningInv,MinBalance,NetAvailable,FirstStockout,Status",
      'SO1,X,"Part",1,no,6,4,-2,-2,2026-11-01,shortfall',
    ]);
  });
});

describe("Replenishment", () => {
  it("auto-selects the first FG with demand and shows BOM and vendor summary", async () => {
    renderApp({ ui: <Replenishment /> });
    await screen.findByRole("heading", { name: "Supply Detail & Replenishment" });
    expect(await screen.findByText("Bill of Materials — Component Supply Status")).toBeInTheDocument();
    await screen.findByText("✕ CRITICAL");
    expect(screen.getByText("4 finished good(s) with demand")).toBeInTheDocument();
    expect(screen.getByText(/23 units total demand/)).toBeInTheDocument();
    const a = rowOf("CMP-A");
    expect(within(a).getByText("-15")).toBeInTheDocument();
    expect(within(a).getByText("✕ RED")).toBeInTheDocument();
    const vs = screen.getByText("Vendor Summary — parts requiring orders").closest("section")!;
    expect(within(vs).getByText("Apex Components")).toBeInTheDocument();
    expect(within(vs).getByText("50%")).toBeInTheDocument();
    expect(within(vs).getByText("12m")).toBeInTheDocument();
    expect(within(vs).getByText("CMP-C: $10")).toBeInTheDocument();
    const optgroups = screen.getByLabelText("Select FG").querySelectorAll("optgroup");
    expect([...optgroups].map((g) => g.label)).toEqual(["1000 series", "2000 series", "3000 series", "6000 series"]);
  });

  it("opens the drill dialogs", async () => {
    renderApp({ ui: <Replenishment /> });
    await screen.findByText("✕ CRITICAL");
    await userEvent.click(within(rowOf("CMP-A")).getByRole("button", { name: "15" }));
    const dlg = await screen.findByRole("dialog", { name: "Open purchase orders — CMP-A" });
    expect(within(dlg).getAllByText("V-PO-5001")).toHaveLength(2);
    await userEvent.click(within(dlg).getByRole("button", { name: "Close" }));
    await userEvent.click(within(rowOf("CMP-A")).getByRole("button", { name: "4" }));
    expect(await screen.findByText("P-ORD201001 (released)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "23 units total demand" }));
    const so = await screen.findByRole("dialog", { name: "Demand — sales orders for FG-1000" });
    expect(within(so).getByText("S-ORD101001")).toBeInTheDocument();
  });

  it("switches FG and shows planned demand and sub-assembly rows", async () => {
    renderApp({ ui: <Replenishment /> });
    await screen.findByText("✕ CRITICAL");
    await userEvent.selectOptions(screen.getByLabelText("Select FG"), "FG-6000");
    await screen.findByText("✓ COVERED");
    expect(document.body.textContent).toContain("(1 ordered + 1 planned)");
    expect(screen.getByText("produced in-house — see production orders")).toBeInTheDocument();
    expect(screen.queryByText("Vendor Summary — parts requiring orders")).not.toBeInTheDocument();
  });

  it("honors ?fg=&highlight= and ?item= query parameters", async () => {
    window.history.replaceState(null, "", "/replenishment?fg=FG-3000&highlight=CMP-E&item=CMP-E");
    renderApp({ ui: <Replenishment /> });
    await screen.findByRole("dialog", { name: "Create Purchase Order — CMP-E" });
    expect(window.location.search).toBe("");
    expect(rowOf("CMP-E")).toHaveAttribute("data-highlight", "true");
    expect(screen.getByLabelText(/Order Quantity/)).toHaveValue(3);
  });

  it("shows n/a reliability when it cannot be measured", async () => {
    updateMaster(api.store, "components", (cs) => {
      cs.find((c) => c.item_no === "CMP-E")!.vendor_id = "";
    });
    window.history.replaceState(null, "", "/replenishment?fg=FG-3000");
    renderApp({ ui: <Replenishment /> });
    await screen.findByText("Vendor Summary — parts requiring orders");
    expect(screen.getByText("n/a")).toHaveAttribute("title", "No receipt history or open PO lines to measure");
    expect(screen.getByText("28d")).toBeInTheDocument();
  });

  it("shows an error when supply detail cannot load", async () => {
    window.history.replaceState(null, "", "/replenishment?fg=NOPE");
    renderApp({ ui: <Replenishment /> });
    expect(await screen.findByText("Could not load supply detail.")).toBeInTheDocument();
  });
});
