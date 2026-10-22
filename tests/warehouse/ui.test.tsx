import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Warehouse } from "@/features/warehouse/Warehouse";
import { master } from "@/server/master";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => {
  cleanup();
  api.uninstall();
});

const show = () => renderApp({ ui: <Warehouse /> });
const tab = (name: RegExp) => userEvent.click(screen.getByRole("tab", { name }));
const kpis = async () => (await api.call("GET", "/api/plan")).body.kpis;

describe("warehouse page (AC-WH-12)", () => {
  it("shows the heading and five tabs, with the 4 POs under Receiving", async () => {
    show();
    expect(await screen.findByRole("heading", { name: "Warehousing" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["1 · Receiving", "2 · Completed POs", "3 · Inventory & Moves", "4 · History", "5 · Settings"]);
    expect(await screen.findByRole("button", { name: "PO V-PO-5001" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^PO V-PO-/ })).toHaveLength(4);
    expect(screen.getByText(/Automated posting \(simulated\)/)).toBeInTheDocument();
  });

  it("select-all toggles lines; receipt posts after inline confirm and changes the plan", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "PO V-PO-5001" }));
    const all = await screen.findByLabelText("Select / deselect all lines");
    expect(all).toBeChecked();
    expect(screen.getByRole("button", { name: "Post Receipt (2)" })).toBeEnabled();
    await userEvent.click(all);
    expect(screen.getByRole("button", { name: "Post Receipt (0)" })).toBeDisabled();
    await userEvent.click(all);
    expect(screen.getByRole("button", { name: "Post Receipt (2)" })).toBeEnabled();
    await userEvent.click(screen.getAllByLabelText("Include CMP-A")[0]);
    expect(screen.getByRole("button", { name: "Post Receipt (1)" })).toBeEnabled();
    await userEvent.click(screen.getAllByLabelText("Include CMP-A")[0]); // reselect
    expect(screen.getByRole("button", { name: "Post Receipt (2)" })).toBeEnabled();

    expect((await kpis()).expedite_lines).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: "Post Receipt (2)" }));
    expect(screen.getByText(/Receive 2 line\(s\) on V-PO-5001 at MAIN/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    expect(await screen.findByText(/V-PO-5001: receipt posted · 2\/2 lines OK/)).toBeInTheDocument();
    expect(master(api.store, "vendor_po_lines").filter((l) => l.po_number === "V-PO-5001").every((l) => l.status === "Received")).toBe(true);
    expect((await kpis()).expedite_lines).toBe(2);
    await waitFor(() => expect(screen.queryByRole("button", { name: "PO V-PO-5001" })).not.toBeInTheDocument());
  });

  it("blocks a missing lot and shows over-delivery and rejection messages", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "PO V-PO-5002" }));
    await userEvent.click(screen.getByRole("button", { name: "Post Receipt (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lot number required for: CMP-C");
    await userEvent.type(screen.getByLabelText("Lot CMP-C"), "L-77");
    const qty = screen.getByLabelText("Receive qty CMP-C");
    fireEvent.change(qty, { target: { value: "7" } });
    expect(screen.getByText(/over-delivery — PO line is raised to 7 \(tolerance 5%\)/)).toBeInTheDocument();
    fireEvent.change(qty, { target: { value: "9" } });
    await userEvent.click(screen.getByRole("button", { name: "Post Receipt (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    expect(await screen.findByText(/Rejected: .*exceeds the allowed 6.3/)).toBeInTheDocument();
    expect(master(api.store, "components").find((c) => c.item_no === "CMP-C")!.on_hand).toBe(10);
  });

  it("completed tab lists the outside-app PO and expands lines", async () => {
    show();
    await tab(/Completed POs/);
    expect(await screen.findByText("V-PO-4990")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    await userEvent.click(screen.getByText("V-PO-4990"));
    expect(await screen.findByText("40 / 40")).toBeInTheDocument();
    expect(screen.getByText(/received outside the app/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Filter PO"), "zzz");
    expect(screen.getByText("No completed purchase orders yet.")).toBeInTheDocument();
  });

  it("move and adjust flows end to end, then history", async () => {
    show();
    await tab(/Inventory & Moves/);
    const forms = await screen.findAllByRole("heading", { level: 2 });
    expect(forms.map((h) => h.textContent)).toEqual(["Bin-to-Bin Movement (incl. lot)", "Inventory Quantity Adjustment"]);
    const inputs = screen.getAllByRole("textbox").filter((el) => (el as HTMLInputElement).type === "text");
    await userEvent.type(inputs[0], "cmp-b");
    await waitFor(() => expect(screen.getByLabelText("From bin")).toBeEnabled(), { timeout: 3000 });
    await userEvent.selectOptions(screen.getByLabelText("From bin"), "B-01");
    const qtyInputs = screen.getAllByRole("spinbutton");
    await userEvent.type(qtyInputs[0], "5");
    await userEvent.selectOptions(screen.getByLabelText("To zone"), "RACK-A");
    await userEvent.selectOptions(screen.getByLabelText("To bin"), "A-01");
    await userEvent.click(screen.getByRole("button", { name: "Post Movement" }));
    expect((await screen.findByText(/move posted/)).closest("[role=status]")).toHaveTextContent("CMP-B · 5 · B-01 → A-01");

    // over-limit adjustment is stopped by the form
    await userEvent.type(inputs[1], "cmp-a");
    await waitFor(() => expect(screen.getByLabelText("Bin")).toBeEnabled(), { timeout: 3000 });
    await userEvent.selectOptions(screen.getByLabelText("Bin"), screen.getByRole("option", { name: /A-01 — 12/ }));
    await userEvent.type(qtyInputs[1], "-999");
    await userEvent.click(screen.getByRole("button", { name: "Post Adjustment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 12 available in A-01");
    await userEvent.clear(qtyInputs[1]);
    await userEvent.type(qtyInputs[1], "12");
    await userEvent.click(screen.getByRole("button", { name: "Post Adjustment" }));
    expect(await screen.findByText(/adjust posted/)).toBeInTheDocument();
    expect(master(api.store, "components").find((c) => c.item_no === "CMP-A")!.on_hand).toBe(32);
    expect((await kpis()).critical_items).toBe(2);

    await tab(/History/);
    await userEvent.click(await screen.findByRole("tab", { name: "Movements" }));
    expect(await screen.findByText(/CMP-B × 5: B-01 → A-01/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Adjustments" }));
    const row = (await screen.findByText(/CMP-A \+12 @ A-01/)).closest("tr")!;
    expect(within(row).getByText("posted")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Filter Operator"), "nobody");
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("settings save shows Saved and drives the tolerance", async () => {
    show();
    await tab(/Settings/);
    const tol = await screen.findByLabelText(/Over-delivery tolerance/);
    fireEvent.change(tol, { target: { value: "20" } });
    await userEvent.selectOptions(screen.getByLabelText("Scanner mode"), "camera");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/cockpit/warehouse-settings")).body).toMatchObject({ over_delivery_tolerance_pct: 20, scanner: { mode: "camera" } });
  });

  it("shows server validation errors from settings", async () => {
    show();
    await tab(/Settings/);
    fireEvent.change(await screen.findByLabelText(/Over-delivery tolerance/), { target: { value: "500" } });
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("between 0 and 100");
  });
});
