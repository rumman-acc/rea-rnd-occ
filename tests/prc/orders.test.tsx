import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orders } from "@/features/orders/Orders";
import { PricingWorkbench, PURCHASE_PRICING } from "@/features/pricing/Workbench";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
  sessionStorage.clear();
});
afterEach(() => api.uninstall());

async function open(tab?: string) {
  const user = userEvent.setup();
  renderApp({ ui: <Orders /> });
  await screen.findByRole("tablist");
  if (tab) await user.click(screen.getByRole("tab", { name: tab }));
  return user;
}

const bodyRows = () => within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);

describe("/orders: open orders", () => {
  it("shows the open order book from the plan", async () => {
    await open();
    await screen.findByText("8 open MTO lines · 45 units · $43,975");
    await waitFor(() => expect(screen.getAllByText("FG-1000").length).toBeGreaterThan(0));
    const rows = bodyRows().map((r) => r.querySelector("td")?.textContent);
    expect(rows).toEqual(["S-ORD101001", "S-ORD101006", "S-ORD101008", "S-ORD101005", "S-ORD101007", "S-ORD101003", "S-ORD101004", "S-ORD101002"]);
    const r7 = bodyRows().find((r) => r.textContent?.includes("S-ORD101007"))!;
    expect(r7).toHaveTextContent("None");
    expect(r7).toHaveTextContent("At Risk");
    const r1 = bodyRows()[0];
    expect(r1).toHaveTextContent("P-ORD201001");
    expect(r1).toHaveTextContent("M1000");
    expect(r1).toHaveTextContent("Oct 22");
    expect(r1).toHaveTextContent("3d");
    expect(r1).toHaveTextContent("$6,850");
  });

  it("searches across SO, customer, item and model", async () => {
    const user = await open();
    await screen.findByText(/8 open MTO lines/);
    await user.type(screen.getByLabelText("Search sales orders"), "harbor");
    await screen.findByText(/1 open MTO lines · 2 units · \$6,400/);
    expect(bodyRows()).toHaveLength(1);
  });

  it("sorts by a column header", async () => {
    const user = await open();
    await screen.findByText(/8 open MTO lines/);
    await user.click(screen.getByRole("button", { name: "Open Value" }));
    expect(bodyRows()[0].querySelector("td")?.textContent).toBe("S-ORD101007");
  });
});

describe("/orders: order history", () => {
  it("groups posted invoices and open orders by customer and expands a group", async () => {
    const user = await open("2 · Order History");
    await screen.findByRole("heading", { name: "Sales Order History" });
    const groups = await screen.findAllByTestId("history-group");
    expect(groups.length).toBe(8);
    await user.click(groups.find((g) => g.textContent?.includes("Northwind"))!);
    expect(await screen.findByText("S-ORD100902")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "By Finished Good" }));
    expect((await screen.findAllByTestId("history-group")).length).toBe(4);
  });
});

describe("/orders: price lists (shared workbench)", () => {
  it("shows the seeded book, the simulated BC banner and scope switching", async () => {
    const user = await open("3 · Price Lists");
    await screen.findByRole("heading", { name: "Sales Price Lists" });
    await screen.findByText(/Business Central price lists \(simulated\): two-way sync/);
    const kpis = await screen.findAllByTestId("pricing-kpi");
    expect(kpis[0]).toHaveTextContent("10");
    expect(kpis[0]).toHaveTextContent("4 standard · 6 customer-specific");
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0));
    expect(screen.getByText("Standard price list")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Customer-specific/ }));
    await screen.findByText("Customer-specific price list");
    await waitFor(() => expect(screen.getAllByText("Northwind Water Utilities").length).toBeGreaterThan(0));
  });

  it("adds a single price, then deletes it after confirmation", async () => {
    const user = await open("3 · Price Lists");
    await screen.findByText("Standard price list");
    await user.click(screen.getByRole("button", { name: "Add single price" }));
    const dlg = await screen.findByRole("dialog", { name: "Add / update a single price" });
    await user.type(within(dlg).getByPlaceholderText(/e\.g\./), "FG-2000");
    await user.selectOptions(within(dlg).getByRole("combobox"), "C-02");
    const nums = within(dlg).getAllByRole("spinbutton");
    await user.clear(nums[1]);
    await user.type(nums[1], "500");
    await user.click(within(dlg).getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const list = await api.call("GET", "/api/pricing/list?scope=customer&customer_no=C-02");
    expect(list.body.rows).toHaveLength(1);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /Customer-specific/ }));
    const del = await screen.findByRole("button", { name: "Delete price FG-2000 C-02 0" });
    await user.click(del);
    await waitFor(async () => expect((await api.call("GET", "/api/pricing/list?scope=customer&customer_no=C-02")).body.rows).toHaveLength(0));
  });

  it("uploads a CSV, reviews it, applies approved rows and updates the list and history", async () => {
    const user = await open("3 · Price Lists");
    await screen.findByText("Standard price list");
    const csv = "Item No,Customer No,Quantity,Price\nFG-1000,ALL,0,700\nFG-2000,C-01,0,500\nFG-9999,ALL,0,10\n";
    await user.upload(screen.getByLabelText("Upload price file"), new File([csv], "prices.csv", { type: "text/csv" }));
    await screen.findByText("prices.csv: 3 row(s) staged for review.");
    expect(screen.getByRole("heading", { name: "Review: prices.csv" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve row 3" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Approve 2 clean" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply 2 price(s)" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Apply 2 price(s)" }));
    const dlg = await screen.findByRole("dialog", { name: "Apply price updates" });
    await user.click(within(dlg).getByRole("radio", { name: /Leave them in place/ }));
    await user.click(within(dlg).getByRole("checkbox", { name: /Protect governed/ }));
    await user.click(within(dlg).getByRole("button", { name: "Apply prices" }));
    await screen.findByText(/2 price\(s\) applied, 0 failed/);
    expect(screen.getByText(/written to the BC item card \(simulated\)/)).toBeInTheDocument();
    const std = (await api.call("GET", "/api/pricing/list?scope=standard")).body.rows.find((r: { item_no: string }) => r.item_no === "FG-1000");
    expect(std.price).toBe(700);

    await user.click(screen.getByRole("tab", { name: "4 · Price History" }));
    await screen.findByRole("heading", { name: "Price Update History" });
    expect((await screen.findAllByText("prices.csv")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Price changed").length).toBe(2);
    expect(screen.getByRole("link", { name: "original file" })).toHaveAttribute("href", "/api/pricing/batches/B-1/source");
  });

  it("shows server errors from the upload", async () => {
    const user = await open("3 · Price Lists");
    await screen.findByText("Standard price list");
    await user.upload(screen.getByLabelText("Upload price file"), new File(["only a header"], "bad.csv", { type: "text/csv" }));
    expect(await screen.findByText(/The file has no data rows/)).toBeInTheDocument();
  });

  it("requires a configured external app and stages a simulated sync", async () => {
    const user = await open("3 · Price Lists");
    await screen.findByText("Standard price list");
    await user.click(screen.getByRole("button", { name: /External pricing app/ }));
    const dlg = await screen.findByRole("dialog", { name: "External pricing app" });
    expect(within(dlg).getByText(/Simulated connector/)).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Sync now" })).toBeDisabled();
    await user.selectOptions(within(dlg).getByRole("combobox"), "api");
    await user.click(within(dlg).getByRole("button", { name: "Sync now" }));
    await screen.findByRole("heading", { name: /Review: External pricing app sync \(simulated/ });
  });
});

describe("/orders: pricing auditor", () => {
  it("runs the rule-based audit, dismisses with a note and runs a job", async () => {
    const user = await open("5 · Pricing Auditor");
    await screen.findByRole("heading", { name: "Customer Pricing Auditor" });
    expect(screen.getByText(/not an AI model/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run pricing audit" }));
    await screen.findByRole("heading", { name: /Customer Pricing Auditor \(rule-based\): AT RISK/ });
    expect((await screen.findAllByText("PA-03")).length).toBeGreaterThan(0);

    vi.spyOn(window, "prompt").mockReturnValue("agreed discount");
    const before = (await api.call("GET", "/api/pricing/audit?status=open")).body.findings.length;
    await user.click(screen.getAllByRole("button", { name: "dismiss" })[0]);
    await waitFor(async () => expect((await api.call("GET", "/api/pricing/audit?status=open")).body.findings.length).toBe(before - 1));

    await user.click(screen.getByRole("button", { name: "Run Nightly audit sweep now" }));
    await waitFor(() => expect(screen.getAllByText(/ok · \d+ findings/).length).toBe(1));
    await user.click(screen.getByRole("button", { name: "Run External app sync now" }));
    expect(await screen.findByText(/not configured/)).toBeInTheDocument();
  });
});

describe("reuse by the purchasing page", () => {
  it("mounts the same workbench with the purchase configuration", async () => {
    renderApp({ ui: <PricingWorkbench config={PURCHASE_PRICING} tab="prices" tabs={<span>tabs here</span>} /> });
    await screen.findByRole("heading", { name: "Purchase Price Lists" });
    expect(screen.getByText("tabs here")).toBeInTheDocument();
    await screen.findByText(/Business Central price lists \(simulated\): connected, but writes do not price documents/);
    await waitFor(() => expect(screen.getAllByText("CMP-A").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Derive from purchase invoices" })).toBeInTheDocument();
    expect(screen.getByText(/Standard \(all vendors\)/)).toBeInTheDocument();
    expect(screen.getAllByTestId("pricing-kpi")[1]).toHaveTextContent("vendors with own prices");
  });
});
