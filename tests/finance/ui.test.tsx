import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FinanceCenter } from "@/features/finance/FinanceCenter";
import { FinanceOps } from "@/features/finance/FinanceOps";
import { renderApp } from "../helpers";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const main = () => within(screen.getByRole("main"));
const kpi = (label: string) => {
  const c = screen.getAllByTestId("kpi-card").find((x) => x.querySelector(".kpi__label")?.textContent === label);
  if (!c) throw new Error(label);
  return c;
};
const tab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));

async function openFinance() {
  renderApp({ ui: <FinanceCenter /> });
  expect(await screen.findByRole("heading", { name: "Financial Control Center" })).toBeInTheDocument();
  await screen.findAllByTestId("kpi-card");
}

describe("/finance", () => {
  it("AC-FIN-008 dashboard: notice, ledger KPIs, tabs", async () => {
    await openFinance();
    expect(screen.getByTestId("evidence-notice")).toHaveTextContent("Reconstruction without original reference");
    expect(kpi("Revenue (month)")).toHaveTextContent("$6,625");
    expect(kpi("Net Income (month)")).toHaveTextContent("$2,818");
    expect(kpi("Cash")).toHaveTextContent("$219,880");
    expect(kpi("Receivables")).toHaveTextContent("$43,975");
    expect(kpi("Payables")).toHaveTextContent("$2,997");
    expect(kpi("Revenue at Risk")).toHaveTextContent("$33,858");
    expect(screen.getAllByRole("tab")).toHaveLength(10);
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(main().getByText("No budget for 2026; create one in the Budget tab.")).toBeInTheDocument();
  });

  it("GL browser filters and drills into a document", async () => {
    await openFinance();
    await tab("General Ledger");
    await waitFor(() => expect(screen.getByTestId("gl-total")).toHaveTextContent(/^\d+ line/));
    await userEvent.selectOptions(screen.getByLabelText("Account"), "1100");
    await waitFor(() => expect(screen.getByTestId("gl-total")).toHaveTextContent("8 line(s); debit $43,975.00"));
    await userEvent.click(screen.getByRole("button", { name: "INV-S-ORD101001-10" }));
    expect(await screen.findByTestId("doc-panel")).toHaveTextContent("Balanced");
    expect(screen.getByRole("heading", { name: "Document INV-S-ORD101001-10" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "freight" } });
    await userEvent.selectOptions(screen.getByLabelText("Account"), "");
    await waitFor(() => expect(screen.getByTestId("gl-total")).toHaveTextContent("2 line(s)"));
  });

  it("trial balance, income statement and balance sheet tie out", async () => {
    await openFinance();
    await tab("Trial Balance");
    expect(await screen.findByText("Debits equal credits")).toBeInTheDocument();
    await tab("Income Statement");
    expect(await screen.findByText("Net income")).toBeInTheDocument();
    expect(screen.getByText("$8,140.00")).toBeInTheDocument();
    await tab("Balance Sheet");
    expect(await screen.findByText("Current earnings (not yet closed)")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("BS as of"), { target: { value: "2026-12-31" } });
    await waitFor(() => expect(screen.getAllByText("$266,542.00").length).toBe(3));
  });

  it("budget: seed from actuals, edit and save, errors shown", async () => {
    await openFinance();
    await tab("Budget");
    await screen.findByTestId("budget-totals");
    await userEvent.click(screen.getByRole("button", { name: "Seed from actuals" }));
    await waitFor(() => expect(screen.getByTestId("budget-totals")).toHaveTextContent("Budget revenue $48,372.50"));
    expect((screen.getByLabelText("4000 month 10") as HTMLInputElement).value).toBe("7287.5");
    const cell = screen.getByLabelText("4000 month 1");
    await userEvent.type(cell, "100");
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Budget 2026 saved"));
    expect((await api.call("GET", "/api/finance/budget?year=2026")).body.entries).toHaveLength(16);

    await userEvent.type(screen.getByLabelText("4000 month 2"), "-5");
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("amount must be a number");
  });

  it("sync button runs the simulated connector", async () => {
    await openFinance();
    expect(screen.getByTestId("sync-bar")).toHaveTextContent("never synced");
    await userEvent.click(screen.getByRole("button", { name: "Sync now (simulated)" }));
    await waitFor(() => expect(screen.getByTestId("sync-bar")).toHaveTextContent("last incremental sync"));
    expect(screen.getByTestId("sync-bar")).toHaveTextContent("0 line(s) added");
  });

  it("operational tabs and period change", async () => {
    await openFinance();
    await tab("Receivables");
    expect(screen.getAllByTestId("buckets")[0]).toHaveTextContent("$25,435");
    await tab("Payables");
    expect(screen.getByText("V-PO-5004/1")).toBeInTheDocument();
    await tab("Margin by Series");
    expect(screen.getByText("Total")).toBeInTheDocument();
    await tab("Cash Forecast");
    expect(screen.getAllByRole("row")).toHaveLength(14);
    await userEvent.selectOptions(screen.getByLabelText("Month"), "12");
    await tab("Dashboard");
    await waitFor(() => expect(kpi("Overdue Receivables")).toHaveTextContent("$43,975"));
  });
});

describe("/finance-ops", () => {
  async function openOps() {
    renderApp({ ui: <FinanceOps /> });
    expect(await screen.findByRole("heading", { name: "Finance Ops & Automation" })).toBeInTheDocument();
    await screen.findAllByTestId("kpi-card");
  }

  it("AC-FOP-008 overview with notice, vendors and bank accounts", async () => {
    await openOps();
    expect(screen.getByTestId("evidence-notice")).toHaveTextContent("nothing is sent");
    expect(kpi("Active Accounts")).toHaveTextContent("8 / 12");
    expect(kpi("Enabled Jobs")).toHaveTextContent("3 / 5");
    expect(await screen.findByText("Apex Components")).toBeInTheDocument();
    expect(await screen.findByText("Operating account")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(7);
  });

  it("accounts refresh and mappings end to end", async () => {
    await openOps();
    await tab("Accounts & Mappings");
    await screen.findByText("Cash");
    expect(screen.queryByText("Freight Expense")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    expect(await screen.findByText("Freight Expense")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh accounts (simulated)" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 activated");

    await userEvent.type(screen.getByLabelText("Mapping key"), "3000");
    await userEvent.selectOptions(screen.getByLabelText("Mapping account"), "4100");
    await userEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    expect(await screen.findByRole("button", { name: "Delete M-0001" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete M-0001" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete M-0001" })).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Mapping key"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown series");
  });

  it("settings save and surface validation errors", async () => {
    await openOps();
    await tab("Settings");
    const t = await screen.findByLabelText("Customer terms (days)");
    await userEvent.clear(t);
    await userEvent.type(t, "45");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Settings saved");
    expect((await api.call("GET", "/api/finops/settings")).body.customer_terms_days).toBe(45);
    await userEvent.clear(screen.getByLabelText("Customer terms (days)"));
    await userEvent.type(screen.getByLabelText("Customer terms (days)"), "999");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("customer_terms_days");
  });

  it("jobs: run, toggle, create, delete, and the run log", async () => {
    await openOps();
    await tab("Jobs");
    await screen.findByTestId("job-dunning");
    expect(screen.getByRole("button", { name: "Run Revenue-at-risk alert" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Run PO approval thresholds" }));
    expect(await screen.findByTestId("run-panel")).toHaveTextContent("2 need approval");

    await userEvent.click(screen.getByRole("button", { name: "Enable Revenue-at-risk alert" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Revenue-at-risk alert" })).toBeEnabled());
    const input = screen.getByLabelText("revenue-risk-alert threshold_pct");
    await userEvent.clear(input);
    await userEvent.type(input, "90");
    await userEvent.click(screen.getByRole("button", { name: "Save Revenue-at-risk alert" }));
    await waitFor(async () => {
      const jobs = (await api.call("GET", "/api/finops/jobs")).body.jobs;
      expect(jobs.find((j: { id: string }) => j.id === "revenue-risk-alert").params.threshold_pct).toBe(90);
    });
    await userEvent.click(screen.getByRole("button", { name: "Run Revenue-at-risk alert" }));
    await waitFor(() => expect(screen.getByTestId("run-panel")).toHaveTextContent("within 90%"));

    await userEvent.type(screen.getByLabelText("Job name"), "Ledger check 2");
    await userEvent.selectOptions(screen.getByLabelText("Job kind"), "gl-balance-check");
    await userEvent.click(screen.getByRole("button", { name: "Create job" }));
    expect(await screen.findByRole("button", { name: "Run Ledger check 2" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Ledger check 2" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Run Ledger check 2" })).not.toBeInTheDocument());

    await tab("Run Log");
    expect(await screen.findByText("RUN-0001")).toBeInTheDocument();
    expect(screen.getByText("RUN-0002")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Process filter"), "settings");
    expect(await screen.findByText("No log entries yet.")).toBeInTheDocument();
  });

  it("audit: run, filter and change a finding status", async () => {
    await openOps();
    await tab("Audit");
    await screen.findByText("No findings. Run an audit.");
    await userEvent.click(screen.getByRole("button", { name: "Run audit" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 new finding(s)");
    expect(await screen.findByText("MAN-0001")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Status F-0001"), "resolved");
    await waitFor(async () => expect((await api.call("GET", "/api/finops/audit?status=resolved")).body.findings).toHaveLength(1));
    await userEvent.selectOptions(screen.getByLabelText("Finding status filter"), "open");
    expect(await screen.findByText("No findings. Run an audit.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Window days"));
    await userEvent.type(screen.getByLabelText("Window days"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Run audit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("window_days");
  });

  it("documents: history by kind and folder browser", async () => {
    await openOps();
    await tab("Documents");
    expect(await screen.findByText("INV-S-ORD101001-10")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("History kind"), "purchasing");
    expect(await screen.findByText("BILL-V-PO-5004-1")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "sales/" }));
    expect(await screen.findByTestId("folder-status")).toHaveTextContent("8 file(s)");
    expect(screen.getByText("INV-S-ORD101001-10.json")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: ".. (up)" }));
    expect(await screen.findByRole("button", { name: "manual/" })).toBeInTheDocument();
  });
});
