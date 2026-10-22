import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminCenter } from "@/features/admin/AdminCenter";
import { ReleasesPage } from "@/features/releases/ReleasesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

describe("Admin Center", () => {
  it("shows the evidence notice, users and simulated integrations", async () => {
    renderApp({ ui: <AdminCenter /> });
    expect(await screen.findByText("Pat Planner")).toBeInTheDocument();
    expect(screen.getByTestId("evidence-notice")).toHaveTextContent("without original reference");
    await userEvent.click(screen.getByRole("tab", { name: "Integrations" }));
    expect(await screen.findByText("Business Central")).toBeInTheDocument();
    expect(screen.getAllByText("Simulated")).toHaveLength(3);
  });

  it("creates a backup, data changes, restore brings it back, audit shows it", async () => {
    await api.call("PUT", "/api/settings", { companyName: "Before" });
    renderApp({ ui: <AdminCenter /> });
    await userEvent.click(await screen.findByRole("tab", { name: "Backups" }));
    expect(await screen.findByText("No backups yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
    expect(await screen.findByText("bkp-0001")).toBeInTheDocument();
    await api.call("PUT", "/api/settings", { companyName: "After" });
    await userEvent.click(screen.getByRole("button", { name: "Restore bkp-0001" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    expect(await screen.findByText("Restored bkp-0001.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/settings")).body.companyName).toBe("Before");

    await userEvent.click(screen.getByRole("tab", { name: "Audit log" }));
    expect(await screen.findByText("backup.restore")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search audit log"), "zzzz");
    expect(await screen.findByText("No audit entries match.")).toBeInTheDocument();
  });

  it("deletes a backup and starts a simulated peer", async () => {
    await api.call("POST", "/api/admin/backups");
    renderApp({ ui: <AdminCenter /> });
    await userEvent.click(await screen.findByRole("tab", { name: "Backups" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete bkp-0001" }));
    expect(await screen.findByText("No backups yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Peer instance" }));
    await userEvent.click(screen.getByRole("button", { name: "Start peer instance" }));
    expect(await screen.findByTestId("peer-result")).toHaveTextContent("peer-1 (simulated)");
  });
});

describe("Settings", () => {
  it("edits and saves, shows server validation errors", async () => {
    renderApp({ ui: <SettingsPage /> });
    const company = await screen.findByLabelText("Company name");
    expect(screen.getByTestId("evidence-notice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await userEvent.clear(company);
    await userEvent.type(company, "Globex");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect((await api.call("GET", "/api/settings")).body.companyName).toBe("Globex");

    const horizon = screen.getByLabelText("Planning horizon (weeks)");
    await userEvent.clear(horizon);
    await userEvent.type(horizon, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("planningHorizonWeeks must be an integer between 1 and 104");
  });
});

describe("Releases", () => {
  it("lists releases and simulates an upgrade without changing the version", async () => {
    renderApp({ ui: <ReleasesPage /> });
    expect(await screen.findByText("Running version v1.47.0")).toBeInTheDocument();
    expect(screen.getByText(/Upgrades are simulated/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Simulate upgrade to 1.48.0" }));
    const steps = await screen.findByTestId("upgrade-steps");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(6);
    await waitFor(() => expect(screen.getByText("upg-0001")).toBeInTheDocument());
    expect(screen.getByText("Running version v1.47.0")).toBeInTheDocument();
    expect((await api.call("GET", "/api/version")).body.version).toBe("1.47.0");
  });
});
