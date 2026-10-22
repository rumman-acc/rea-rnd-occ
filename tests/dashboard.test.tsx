import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDemoProvider } from "@/data/demoProvider";
import { FX_ROWS } from "@/data/fixtures";
import type { StatusRow } from "@/domain/types";
import { controlled, stubProvider } from "@/testing/providers";
import { chartConfig, clonePlan, planWith, renderApp, renderLoaded, soNumbers, tableEl, testRuntime } from "./helpers";

const rows = FX_ROWS as StatusRow[];
const short = (ids: string[]) => ids.map((i) => `S-ORD${i}`);
const DEFAULT_ORDER = short(["101001", "101006", "101005", "101007", "101004", "101008", "101003"]);

const kpiCards = () => screen.getAllByTestId("kpi-card");
const kpiByLabel = (label: string) => {
  const card = kpiCards().find((c) => c.querySelector(".kpi__label")?.textContent === label);
  if (!card) throw new Error(`no KPI card ${label}`);
  return card;
};
// The page-level header; testing-library maps every <header> (incl. card headers) to "banner".
const pageHeader = () => document.querySelector<HTMLElement>("header.header")!;
const kpiTexts = () => kpiCards().map((c) => c.textContent);

describe("AC-001 frame", () => {
  it("renders header, status, as-of time, refresh and profile", async () => {
    await renderLoaded();
    const header = pageHeader();
    expect(within(header).getByText("Dashboard")).toBeInTheDocument();
    expect(within(header).getByText("Acme OCC · Operations Control Center")).toBeInTheDocument();
    expect(screen.getByTestId("status-text")).toHaveTextContent("Demo data");
    expect(screen.getByTestId("status-dot")).not.toHaveClass("status__dot--bad");
    expect(header).toHaveTextContent("as of 7:11:44 PM");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Profile" })).toHaveTextContent("AM");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("profile popover shows the fixture user and an inert Sign out", async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    expect(screen.getByText("alex.morgan@example.com")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();
  });
});

describe("AC-002 refresh via provider", () => {
  it("one initial call, one refresh call, disabled while pending, no HTTP", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = controlled(createDemoProvider());
    await renderLoaded({ provider });
    expect(provider.planCalls).toEqual([{ refresh: false }]);

    const release = provider.hold();
    const button = screen.getByRole("button", { name: "Refresh" });
    await userEvent.click(button);
    expect(provider.planCalls).toEqual([{ refresh: false }, { refresh: true }]);
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")).toHaveClass("spin");
    // Existing content stays visible during a refresh (FR-024).
    expect(screen.getByRole("heading", { name: "Operations Dashboard" })).toBeInTheDocument();

    await act(async () => release());
    expect(button).toBeEnabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("AC-003 navigation", () => {
  it("six groups, 17 items, order, hrefs, active item", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(17);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/", "/ai-cockpit", "/orders", "/sop", "/supply", "/replenishment", "/purchasing", "/warehouse",
      "/production", "/gantt", "/capacity", "/costing", "/finance", "/finance-ops", "/admin", "/settings", "/releases",
    ]);
    const labels = links.map((l) => l.querySelector(".navitem__label")?.textContent);
    expect(labels).toEqual([
      "Dashboard", "AI & HITL Cockpit", "Sales Orders", "S&OP Planning", "Supply Explorer", "Replenishment",
      "Purchasing", "Warehousing", "Prod Orders", "Schedule & Simulate", "Capacity", "Product Costing",
      "Financial Control Center", "Finance Ops & Automation", "Admin Center", "Settings", "Releases & Upgrades",
    ]);
    const groups = Array.from(nav.querySelectorAll(".sidebar__group")).map((g) => g.textContent);
    expect(groups).toEqual(["Operations", "Sales & Planning", "Inventory & Supply", "Production", "Finance", "Admin"]);
    const active = links.filter((l) => l.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/");
  });

  it("highlights whichever item matches the current path", async () => {
    globalThis.__testPathname = "/orders";
    await renderApp({ ui: <div /> });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: /Sales Orders/ })).toHaveAttribute("aria-current", "page");
    expect(within(pageHeader()).getByText("Sales Orders")).toBeInTheDocument();
  });
});

describe("AC-004 badge", () => {
  it("shows the count of red rows on the Dashboard item", async () => {
    await renderLoaded();
    expect(screen.getByTestId("nav-badge")).toHaveTextContent("5");
  });

  it("is absent with zero red rows", async () => {
    await renderLoaded({ provider: stubProvider(planWith({ rows: rows.filter((r) => r.health !== "red") })) });
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
  });

  it("is absent when the sidebar is collapsed", async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: /Collapse/ }));
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
  });
});

describe("AC-005 collapse and version", () => {
  it("collapses to icons with tooltips and hides text, version and badge", async () => {
    await renderLoaded();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).not.toHaveClass("sidebar--collapsed");
    expect(await screen.findByText("v1.47.0 · Demo")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Collapse/ }));
    expect(sidebar).toHaveClass("sidebar--collapsed");
    expect(screen.queryByText("v1.47.0 · Demo")).not.toBeInTheDocument();
    expect(sidebar.querySelector(".sidebar__group")).toBeNull();
    const dash = within(sidebar).getByRole("link", { name: "Dashboard" });
    expect(dash).toHaveAttribute("title", "Dashboard");
    expect(dash.querySelector(".navitem__label")).toBeNull();
  });

  it("omits the version line if getVersion fails, and the page still works", async () => {
    const provider = controlled(createDemoProvider());
    provider.failVersion(new Error("nope"));
    await renderLoaded({ provider });
    expect(screen.queryByText(/Demo$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operations Dashboard" })).toBeInTheDocument();
  });

  it("is expanded again on each load (state is not persisted)", async () => {
    const first = await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: /Collapse/ }));
    first.unmount();
    await renderLoaded();
    expect(screen.getByTestId("sidebar")).not.toHaveClass("sidebar--collapsed");
  });
});

describe("AC-006 heading and links", () => {
  it("heading, date subline and links", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1, name: "Operations Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/Monday, October 19, 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^Acme Industries Inc\. ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /S&OP View/ })).toHaveAttribute("href", "/sop");
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/orders");
  });
});

describe("AC-007 KPI display", () => {
  it("six cards in order with labels, values and captions", async () => {
    await renderLoaded();
    const cards = kpiCards().map((c) => [
      c.querySelector(".kpi__label")!.textContent,
      c.querySelector(".kpi__value")!.textContent,
      c.querySelector(".kpi__sub")!.textContent,
    ]);
    expect(cards).toEqual([
      ["Open SO Lines", "8", "45 units"],
      ["Open Order Value", "$43,975", "outstanding revenue"],
      ["On-Time Coverage", "50%", "linked POs ending in time"],
      ["PO Linkage", "75%", "SOs with a production order"],
      ["Critical Materials", "3", "3 expedites needed"],
      ["Revenue at Risk", "$33,858", "red + partial yellow exposure"],
    ]);
  });
});

describe("AC-008 KPI tones", () => {
  it("fixture tones", async () => {
    await renderLoaded();
    const tone = (l: string) => kpiByLabel(l).getAttribute("data-tone");
    expect(tone("On-Time Coverage")).toBe("red");
    expect(tone("PO Linkage")).toBe("amber");
    expect(tone("Critical Materials")).toBe("amber");
    expect(tone("Revenue at Risk")).toBe("amber");
    expect(tone("Open SO Lines")).toBe("blue");
    expect(tone("Open Order Value")).toBe("blue");
  });

  it.each([
    ["On-Time Coverage", "on_time_pct", [74, 75, 89, 90], ["red", "amber", "amber", "green"]],
    ["PO Linkage", "linked_pct", [59, 60, 89, 90], ["red", "amber", "amber", "green"]],
    ["Critical Materials", "critical_items", [0, 5, 6], ["green", "amber", "red"]],
  ] as const)("%s thresholds", async (label, field, inputs, expected) => {
    for (let i = 0; i < inputs.length; i++) {
      const view = await renderLoaded({ provider: stubProvider(planWith({ kpis: { [field]: inputs[i] } })) });
      expect(kpiByLabel(label).getAttribute("data-tone")).toBe(expected[i]);
      view.unmount();
    }
  });

  it("Revenue at Risk stays amber for any value", async () => {
    await renderLoaded({ provider: stubProvider(planWith({ kpis: { revenue_at_risk: 0 } })) });
    expect(kpiByLabel("Revenue at Risk").getAttribute("data-tone")).toBe("amber");
  });
});

describe("AC-009 no KPI computation", () => {
  it("changing one KPI changes only that card", async () => {
    const base = await renderLoaded();
    const before = kpiTexts();
    base.unmount();
    await renderLoaded({ provider: stubProvider(planWith({ kpis: { revenue_at_risk: 1 } })) });
    const after = kpiTexts();
    expect(after[5]).toContain("$1");
    expect(after.slice(0, 5)).toEqual(before.slice(0, 5));
  });

  it("changing rows while holding kpis changes no KPI card", async () => {
    const base = await renderLoaded();
    const before = kpiTexts();
    base.unmount();
    const changed = rows.slice(0, 2).map((r) => ({ ...r, health: "green" as const }));
    await renderLoaded({ provider: stubProvider(planWith({ rows: changed })) });
    expect(kpiTexts()).toEqual(before);
  });
});

describe("AC-010 donut", () => {
  it("counts rows by health, colors, legend position", async () => {
    await renderLoaded();
    const { data, options } = chartConfig("chart-doughnut");
    expect(data.labels).toEqual(["Safe", "Watch", "At Risk"]);
    expect(data.datasets[0].data).toEqual([1, 2, 5]);
    expect(data.datasets[0].backgroundColor).toEqual(["#16a34a", "#d97706", "#dc2626"]);
    expect(options).toMatchObject({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } });
    expect(screen.getByRole("heading", { name: "Order Book Health" })).toBeInTheDocument();
  });

  it("recoloring one red row to green gives 2/2/4", async () => {
    const changed = rows.map((r) => (r.so_number === "S-ORD101001" ? { ...r, health: "green" as const } : r));
    await renderLoaded({ provider: stubProvider(planWith({ rows: changed })) });
    expect(chartConfig("chart-doughnut").data.datasets[0].data).toEqual([2, 2, 4]);
  });
});

describe("AC-011 bar", () => {
  it("series totals, label, legend hidden, y starts at zero", async () => {
    await renderLoaded();
    const { data, options } = chartConfig("chart-bar");
    expect(data.labels).toEqual(["1000", "2000", "3000", "6000"]);
    expect(data.datasets[0].data).toEqual([23, 18, 3, 1]);
    expect(data.datasets[0].label).toBe("Units");
    expect(options).toMatchObject({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
    expect(screen.getByRole("heading", { name: "Open Demand by Series (units)" })).toBeInTheDocument();
  });

  it("groups rows without a series as 'other'", async () => {
    const changed = [...rows, { ...rows[0], so_number: "S-ORD999", series: null, quantity: 4 }];
    await renderLoaded({ provider: stubProvider(planWith({ rows: changed })) });
    const { data } = chartConfig("chart-bar");
    expect(data.labels).toContain("other");
    expect(data.datasets[0].data[data.labels.indexOf("other")]).toBe(4);
  });

  it("exposes a text alternative for the charts", async () => {
    await renderLoaded();
    expect(screen.getByRole("img", { name: /Order book health.*Safe 1, Watch 2, At Risk 5/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /1000 23, 2000 18, 3000 3, 6000 1/ })).toBeInTheDocument();
  });
});

describe("AC-012 table content", () => {
  it("lists the non-green rows in provider order with the specified text", async () => {
    await renderLoaded();
    expect(soNumbers()).toEqual(DEFAULT_ORDER);
    expect(screen.queryByText("S-ORD101002")).not.toBeInTheDocument();

    const body = tableEl().querySelector("tbody")!;
    const first = within(body).getAllByRole("row")[0];
    expect(Array.from(first.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "S-ORD101001", "Northwind Water Utilities", "1000", "Oct 22", "10", "$6,850", "At Risk",
    ]);
    const last = within(body).getAllByRole("row")[6];
    expect(Array.from(last.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "S-ORD101003", "Harbor Marine Supply", "3000", "Nov 20", "2", "$6,400", "Watch",
    ]);
    const headers = within(tableEl()).getAllByRole("columnheader").map((h) => h.querySelector("button")!.textContent);
    expect(headers).toEqual(["SO #", "Customer", "Series", "Delivery", "Qty", "Value", "Status"]);
  });

  it("shows the empty state when there are no non-green rows", async () => {
    await renderLoaded({ provider: stubProvider(planWith({ rows: rows.filter((r) => r.health === "green") })) });
    expect(screen.getByText("All orders healthy. 🎉")).toBeInTheDocument();
  });

  it("marks overdue dates bold red against the injected clock", async () => {
    const first = await renderLoaded();
    expect(tableEl().querySelectorAll(".overdue")).toHaveLength(0);

    first.unmount();
    await renderLoaded({ runtime: testRuntime("2026-10-23T12:00:00Z") });
    const overdue = tableEl().querySelectorAll(".overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].closest("tr")).toHaveTextContent("S-ORD101001");
  });

  it("tints rows and renders status pills by health", async () => {
    await renderLoaded();
    const trs = within(tableEl().querySelector("tbody")!).getAllByRole("row");
    expect(trs[0]).toHaveClass("row--red");
    expect(trs[5]).toHaveClass("row--yellow");
    expect(within(trs[0]).getByText("At Risk")).toHaveClass("pill--red");
    expect(within(trs[5]).getByText("Watch")).toHaveClass("pill--yellow");
  });
});

describe("AC-013 sort", () => {
  const sortButton = (name: RegExp) => within(tableEl()).getByRole("button", { name });

  it("QTY ascending, descending, off; arrows shown", async () => {
    await renderLoaded();
    const qty = () => sortButton(/^Qty/);
    await userEvent.click(qty());
    expect(soNumbers()).toEqual(short(["101007", "101004", "101003", "101008", "101005", "101001", "101006"]));
    expect(qty()).toHaveTextContent("Qty ▲");
    await userEvent.click(qty());
    expect(soNumbers()).toEqual(short(["101006", "101001", "101005", "101008", "101003", "101007", "101004"]));
    expect(qty()).toHaveTextContent("Qty ▼");
    await userEvent.click(qty());
    expect(soNumbers()).toEqual(DEFAULT_ORDER);
    expect(qty()).toHaveTextContent(/^Qty$/);
  });

  it("VALUE twice gives descending; CUSTOMER sorts by name", async () => {
    await renderLoaded();
    await userEvent.click(sortButton(/^Value/));
    await userEvent.click(sortButton(/^Value/));
    expect(soNumbers()).toEqual(short(["101004", "101001", "101006", "101003", "101005", "101008", "101007"]));
    await userEvent.click(sortButton(/^Customer/));
    expect(soNumbers()).toEqual(short(["101006", "101003", "101007", "101005", "101001", "101008", "101004"]));
    // The previous sort is replaced; only the active column shows an arrow.
    expect(sortButton(/^Value/)).toHaveTextContent(/^Value$/);
    expect(sortButton(/^Customer/)).toHaveTextContent("Customer ▲");
  });

  it("clicking another column after CUSTOMER sorts by that column only", async () => {
    await renderLoaded();
    await userEvent.click(sortButton(/^Customer/));
    await userEvent.click(sortButton(/^Value/));
    expect(soNumbers()).toEqual(short(["101007", "101008", "101005", "101003", "101006", "101001", "101004"]));
    expect(sortButton(/^Value/)).toHaveTextContent("Value ▲");
    expect(sortButton(/^Customer/)).toHaveTextContent(/^Customer$/);
  });

  it("typing in a filter does not change the sort", async () => {
    await renderLoaded();
    await userEvent.click(sortButton(/^Qty/));
    await userEvent.type(screen.getByRole("textbox", { name: "Filter Customer" }), "a");
    expect(sortButton(/^Qty/)).toHaveTextContent("Qty ▲");
  });
});

describe("AC-014 filter on displayed text", () => {
  const filter = (column: string) => screen.getByRole("textbox", { name: `Filter ${column}` });

  it("has one filter per column with a 'filter…' placeholder", async () => {
    await renderLoaded();
    const inputs = within(tableEl()).getAllByRole("textbox");
    expect(inputs).toHaveLength(7);
    inputs.forEach((i) => expect(i).toHaveAttribute("placeholder", "filter…"));
  });

  it("customer, status, delivery and value match what is displayed", async () => {
    await renderLoaded();
    await userEvent.type(filter("Customer"), "MER");
    expect(soNumbers()).toEqual(["S-ORD101005"]);
    await userEvent.clear(filter("Customer"));
    await userEvent.type(filter("Status"), "watch");
    expect(soNumbers()).toEqual(short(["101008", "101003"]));
    await userEvent.clear(filter("Status"));
    await userEvent.type(filter("Delivery"), "nov");
    expect(soNumbers()).toEqual(short(["101007", "101004", "101003"]));
    await userEvent.clear(filter("Delivery"));
    await userEvent.type(filter("Value"), "$6,");
    expect(soNumbers()).toEqual(short(["101001", "101006", "101003"]));
  });

  it("combines columns with AND and ignores padding/whitespace", async () => {
    await renderLoaded();
    await userEvent.type(filter("Status"), "at risk");
    await userEvent.type(filter("Series"), "1000");
    expect(soNumbers()).toEqual(short(["101001", "101005"]));
    await userEvent.type(filter("Customer"), "north");
    expect(soNumbers()).toEqual(["S-ORD101001"]);
    await userEvent.clear(filter("Customer"));
    await userEvent.type(filter("Customer"), "   ");
    expect(soNumbers()).toEqual(short(["101001", "101005"]));
  });

  it.each([
    ["Status", "red"],
    ["Delivery", "2026"],
    ["Value", "6850"],
  ])("intentional deviation: raw %s text %s matches nothing, with no empty-state message", async (column, text) => {
    await renderLoaded();
    await userEvent.type(filter(column), text);
    expect(soNumbers()).toEqual([]);
    expect(screen.queryByText("All orders healthy. 🎉")).not.toBeInTheDocument();
  });

  it("filters, then sorts", async () => {
    await renderLoaded();
    await userEvent.type(filter("Status"), "at risk");
    await userEvent.click(within(tableEl()).getByRole("button", { name: /^Qty/ }));
    expect(soNumbers()).toEqual(short(["101007", "101004", "101005", "101001", "101006"]));
  });

  it("sort and filter state resets on remount (TBL-025)", async () => {
    const first = await renderLoaded();
    await userEvent.type(filter("Customer"), "mer");
    first.unmount();
    await renderLoaded();
    expect(soNumbers()).toEqual(DEFAULT_ORDER);
  });
});

describe("AC-016 supply health", () => {
  it("one block per series with units and a 30% red bar", async () => {
    await renderLoaded();
    const bars = ["1000", "2000", "3000", "6000"].map((s) => screen.getByTestId(`supply-bar-${s}`));
    bars.forEach((b) => {
      expect(b).toHaveStyle({ width: "30%" });
      expect(b).toHaveAttribute("data-health", "red");
    });
    const card = screen.getByRole("heading", { name: "Supply Health by Series" }).closest("section")!;
    expect(card).toHaveTextContent("1000");
    expect(Array.from(card.querySelectorAll(".supply__units")).map((e) => e.textContent)).toEqual([
      "23 units", "18 units", "3 units", "1 units",
    ]);
  });

  it("yellow worst gives 65% amber; green worst gives 100% green", async () => {
    const yellowOnly = rows.filter((r) => r.series === "1000").map((r) => ({ ...r, health: "yellow" as const }));
    const first = await renderLoaded({ provider: stubProvider(planWith({ rows: yellowOnly })) });
    expect(screen.getByTestId("supply-bar-1000")).toHaveStyle({ width: "65%" });
    expect(screen.getByTestId("supply-bar-1000")).toHaveAttribute("data-health", "yellow");

    first.unmount();
    const greenOnly = rows.filter((r) => r.series === "1000").map((r) => ({ ...r, health: "green" as const }));
    await renderLoaded({ provider: stubProvider(planWith({ rows: greenOnly })) });
    expect(screen.getByTestId("supply-bar-1000")).toHaveStyle({ width: "100%" });
  });
});

describe("AC-017 states", () => {
  it("shows 'Loading plan…' and no KPI cards while the first load is pending", async () => {
    const provider = controlled(createDemoProvider());
    const release = provider.hold();
    renderApp({ provider });
    expect(await screen.findByText(/Loading plan…/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("kpi-card")).toHaveLength(0);
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: "Operations Dashboard" })).toBeInTheDocument();
  });

  it("first load failure: empty body, banner with the error, Offline header", async () => {
    const provider = controlled(createDemoProvider());
    provider.failPlan(new Error("boom"));
    renderApp({ provider });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the plan.");
    expect(alert).toHaveTextContent("boom");
    expect(screen.getByTestId("status-text")).toHaveTextContent("Offline");
    expect(screen.getByTestId("status-dot")).toHaveClass("status__dot--bad");
    expect(screen.queryByRole("heading", { name: "Operations Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeEmptyDOMElement();
  });

  it("refresh failure after success keeps content, no banner, header Offline", async () => {
    const provider = controlled(createDemoProvider());
    await renderLoaded({ provider });
    provider.failPlan(new Error("later"), { refreshOnly: true });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operations Dashboard" })).toBeInTheDocument();
  });
});

describe("AC-020 provider boundary", () => {
  it("a stub provider changes what the page shows with no UI change", async () => {
    const plan = clonePlan();
    plan.kpis = { ...plan.kpis, open_so_lines: 99, open_value: 1234 };
    plan.status_board = [{ ...rows[0], so_number: "S-ORD777", customer_name: "Stub Customer", series: "7000" }];
    await renderLoaded({ provider: stubProvider(plan, "9.9.9") });
    expect(kpiByLabel("Open SO Lines")).toHaveTextContent("99");
    expect(kpiByLabel("Open Order Value")).toHaveTextContent("$1,234");
    expect(soNumbers()).toEqual(["S-ORD777"]);
    expect(await screen.findByText("v9.9.9 · Demo")).toBeInTheDocument();
    expect(chartConfig("chart-bar").data.labels).toEqual(["7000"]);
  });
});

describe("AC-022 Ask Fluid stays inert; sign-out and simulation are wired", () => {
  it("Ask Fluid does nothing and makes no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await renderLoaded();
    const assistant = screen.getByRole("button", { name: "Open Ask Fluid assistant" });
    const before = document.body.innerHTML;
    await userEvent.click(assistant);
    expect(document.body.innerHTML).toBe(before);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Sign out calls the session's sign-out handler", async () => {
    const onSignedOut = vi.fn();
    await renderLoaded({ onSignedOut });
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await userEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });

  it("without a session there is no profile button", async () => {
    await renderLoaded({ user: null });
    expect(screen.queryByRole("button", { name: "Profile" })).not.toBeInTheDocument();
  });

  it("no simulation banner unless simulation mode is on", async () => {
    await renderLoaded();
    expect(screen.queryByText(/Simulation Mode/)).not.toBeInTheDocument();
  });
});
