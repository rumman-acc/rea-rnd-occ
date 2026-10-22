import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Purchasing } from "@/features/purchasing/Purchasing";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  api.uninstall();
});

async function open(tab?: string) {
  const user = userEvent.setup();
  renderApp({ ui: <Purchasing /> });
  await screen.findByRole("tablist", { name: "Purchasing sections" });
  if (tab) await user.click(screen.getByRole("tab", { name: tab }));
  return user;
}

const selection = () => screen.getByTestId("pu-selection");
const rowOf = (text: string) => screen.getAllByRole("row").find((r) => r.textContent?.includes(text))!;

describe("/purchasing", () => {
  it("shows the page heading and the six tabs", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Purchasing" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "1 · Buy Cockpit", "2 · Open POs", "3 · PO History", "4 · Price Lists", "5 · Price History", "6 · Pricing Auditor",
    ]);
    expect(screen.getByRole("tab", { name: "1 · Buy Cockpit" })).toHaveAttribute("aria-selected", "true");
  });

  it("Buy Cockpit lists the red/yellow components, says it is rule based and shows the persona", async () => {
    await open();
    await screen.findByText(/Buy Recommendations — 4 of 4 red\/yellow components/);
    expect(screen.getByText(/not produced by an AI model/)).toBeInTheDocument();
    expect(screen.getByText(/Senior Buyer \(rule-based\) — AI purchasing persona/)).toBeInTheDocument();
    expect(screen.getByText(/balanced quantities · arrive 3d early · horizon auto · MOQ-rounded/)).toBeInTheDocument();
    for (const item of ["CMP-A", "CMP-C", "CMP-E", "CMP-D"]) expect(rowOf(item)).toBeTruthy();
    expect(rowOf("CMP-D")).toHaveTextContent("Expedite open PO");
    expect(rowOf("CMP-E")).toHaveTextContent("Expedite");
    expect(rowOf("CMP-E")).toHaveTextContent("5 @ 116.4");
    expect(selection()).toHaveTextContent("0 line(s) selected across 0 vendor(s)");
    expect(screen.getByRole("button", { name: /^Post POs/ })).toBeDisabled();
  });

  it("marks a row edited, restores the suggestion and filters by series", async () => {
    const user = await open();
    await screen.findByText(/Buy Recommendations/);
    const qty = screen.getByLabelText("Quantity for CMP-E");
    await user.clear(qty);
    await user.type(qty, "8");
    expect(rowOf("CMP-E")).toHaveTextContent("edited");
    expect(rowOf("CMP-E")).toHaveTextContent("Restore AI");
    await user.click(within(rowOf("CMP-E")).getByRole("button", { name: "Restore AI" }));
    expect(screen.getByLabelText("Quantity for CMP-E")).toHaveValue(5);
    expect(rowOf("CMP-E")).not.toHaveTextContent("edited");

    await user.selectOptions(screen.getByLabelText("Series"), "3000");
    await screen.findByText(/Buy Recommendations — 2 of 4/);
    await user.click(screen.getByRole("button", { name: "clear" }));
    await screen.findByText(/4 of 4/);
  });

  it("expands a row to show the supply picture and projection, and opens the popups", async () => {
    const user = await open();
    await screen.findByText(/Buy Recommendations/);
    await user.click(screen.getByRole("button", { name: "Show details for CMP-A" }));
    await screen.findByText("CMP-A — supply picture");
    expect(screen.getByText("Net shortfall (window)")).toBeInTheDocument();
    await screen.findByRole("img", { name: /Inventory projection for CMP-A/ });
    await user.click(screen.getByRole("button", { name: /PO\(s\), 2 line\(s\)/ }));
    const dlg = await screen.findByRole("dialog", { name: "Open purchase orders covering CMP-A" });
    expect(within(dlg).getAllByText("V-PO-5001").length).toBe(2);
    expect(dlg).toHaveTextContent("Total open — 1 PO(s), 2 line(s)");
    await user.click(within(dlg).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /SO\(s\)/ }));
    const so = await screen.findByRole("dialog", { name: /Demand behind CMP-A/ });
    expect(so).toHaveTextContent("S-ORD101001");
    expect(so).toHaveTextContent("S&OP plan");
  });

  it("saves the persona and re-suggests", async () => {
    const user = await open();
    await screen.findByText(/Buy Recommendations/);
    await user.click(screen.getByRole("button", { name: "Persona Settings" }));
    await user.selectOptions(screen.getByLabelText("Quantity posture"), "covered");
    await user.click(screen.getByRole("button", { name: /Save & re-suggest/ }));
    await screen.findByText(/covered quantities/);
    expect((await api.call("GET", "/api/cockpit/persona")).body.risk_posture).toBe("covered");
  });

  it("posts a selected line end to end: strip, journal, Open POs, PO History, plan", async () => {
    const user = await open();
    await screen.findByText(/Buy Recommendations/);
    await user.click(screen.getByLabelText("Select CMP-E"));
    await waitFor(() => expect(selection()).toHaveTextContent("1 line(s) selected across 1 vendor(s) · total $582"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /Post 1 PO\(s\) \(simulated\)/ }));
    await screen.findByText("PO V-PO-B1001 created");
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain("1 purchase order(s)");
    expect(screen.getByText(/Unreleased, in the local simulated connector/)).toBeInTheDocument();
    // CMP-E is now covered (yellow, nothing to buy); the selection is cleared
    await waitFor(() => expect(rowOf("CMP-E")).toHaveTextContent("Expedite open PO"));
    expect(selection()).toHaveTextContent("0 line(s) selected");
    expect((await api.call("GET", "/api/plan")).body.kpis.critical_items).toBe(2);
    const po = (await api.call("GET", "/api/cockpit/open-pos")).body.find((p: { po_number: string }) => p.po_number === "V-PO-B1001");
    expect(po).toMatchObject({ vendor_no: "V-200", qty_ordered: 5 });
    await user.click(screen.getByRole("button", { name: "Dismiss confirmations" }));
    expect(screen.queryByText("PO V-PO-B1001 created")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "2 · Open POs" }));
    await screen.findByText(/Purchase Orders — 5 of 5 open & released documents/);
    expect(rowOf("V-PO-B1001")).toHaveTextContent("Open");
    expect(rowOf("V-PO-5001")).toHaveTextContent("Released");

    await user.click(screen.getByRole("tab", { name: "3 · PO History" }));
    await screen.findByText(/POs created from the app/);
    await waitFor(() => expect(rowOf("V-PO-B1001")).toBeTruthy());
    expect(rowOf("V-PO-B1001")).toHaveTextContent("Alex Morgan");
  });

  it("reports a failed PO for an unassigned vendor through the API strip", async () => {
    const user = await open();
    await screen.findByText(/Buy Recommendations/);
    // vendors cannot be unassigned in the seed, so post straight through the API and view the history
    await api.call("POST", "/api/cockpit/post-pos", { operator: "t", lines: [{ item_no: "CMP-F", vendor_no: "V-404", qty: 1, price: 1, delivery_date: "2026-11-01" }] });
    await user.click(screen.getByRole("tab", { name: "3 · PO History" }));
    await waitFor(() => expect(rowOf("failed")).toBeTruthy());
  });

  it("PO History groups by vendor and by item, expands, and shows totals", async () => {
    const user = await open("3 · PO History");
    await waitFor(() => expect(screen.getByTestId("pu-history-summary")).toHaveTextContent(/10 purchase orders · ordered/));
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.getByText(/No POs created from the app yet/)).toBeInTheDocument();
    await user.click(rowOf("Apex Components"));
    expect(await screen.findByText("V-PO-H1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "By Item" }));
    expect(rowOf("CMP-A")).toBeTruthy();
    await user.click(rowOf("CMP-A"));
    expect(await screen.findAllByText("V-PO-5001")).not.toHaveLength(0);
  });

  it("Open POs lists the seeded POs as Released", async () => {
    await open("2 · Open POs");
    await screen.findByText(/Purchase Orders — 4 of 4 open & released documents/);
    for (const po of ["V-PO-5001", "V-PO-5002", "V-PO-5003", "V-PO-5004"]) expect(rowOf(po)).toHaveTextContent("Released");
    expect(rowOf("V-PO-5001")).toHaveTextContent("0 / 15");
  });

  it("mounts the shared pricing workbench for tabs 4 to 6", async () => {
    const user = await open("4 · Price Lists");
    await screen.findByRole("heading", { name: "Purchase Price Lists" });
    expect(await screen.findByText("Derive from purchase invoices")).toBeInTheDocument();
    expect(screen.getByText(/Standard \(all vendors\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "5 · Price History" }));
    await screen.findByRole("heading", { name: "Price Update History" });
    await user.click(screen.getByRole("tab", { name: "6 · Pricing Auditor" }));
    await screen.findByRole("heading", { name: "Vendor Pricing Auditor" });
  });
});
