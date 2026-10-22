import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiCockpit } from "@/features/ai/AiCockpit";
import { listAudit } from "@/server/audit";
import { installApi, type InstalledApi } from "../support/inprocess";
import { renderApp } from "../helpers";

let api: InstalledApi;
beforeEach(() => {
  localStorage.clear();
  api = installApi();
});
afterEach(() => api.uninstall());

async function renderCockpit() {
  const r = renderApp({ ui: <AiCockpit fastPollMs={30} slowPollMs={60} /> });
  await screen.findByRole("heading", { name: "AI & HITL Cockpit" });
  await screen.findByText("Replenishment Buyer");
  return r;
}

describe("AI cockpit page", () => {
  it("renders the sections, the simulated notice and published flow tile", async () => {
    await renderCockpit();
    expect(screen.getByText(/simulated: deterministic, rule-based/)).toBeInTheDocument();
    for (const t of ["Live Agent Telemetry", "AI Persona Builder"]) expect(await screen.findByRole("heading", { name: t })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "HITL Action Inbox (0 pending)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved Agentic Plans (0)" })).toBeInTheDocument();
    expect(screen.getByText(/Inbox zero/)).toBeInTheDocument();
    expect(screen.getByText(/No agent runs yet/)).toBeInTheDocument();
    expect(await screen.findByText("Shortage to purchase order")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SIMULATION — approvals are saved/ })).toBeInTheDocument();
  });

  it("toggles simulation mode through the API", async () => {
    const user = userEvent.setup();
    await renderCockpit();
    await user.click(await screen.findByRole("button", { name: /SIMULATION — approvals are saved/ }));
    await screen.findByRole("button", { name: /LIVE — approvals execute/ });
    expect((await api.call("GET", "/api/ai/config")).body.simulation_mode).toBe(false);
  });

  it("run agent, approve in simulation (journaled with the acting id), then validate and discard the saved plan", async () => {
    const user = userEvent.setup();
    await renderCockpit();
    const who = screen.getByTitle(/Human id journaled/);
    await user.clear(who);
    await user.type(who, "alice");
    expect(localStorage.getItem("occ_operator")).toBe("alice");

    await user.click(within(screen.getByTestId("agent-replenishment")).getByRole("button", { name: "Run" }));
    await screen.findByText(/decisions? waiting/, undefined, { timeout: 4000 });
    const card = (await screen.findAllByTestId(/^inbox-/))[0];
    await user.click(within(card).getByRole("button", { name: /View AI Logic/ }));
    expect(within(card).getByText("Risk inflation")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Approve & Save Plan (simulation)" }));
    await within(card).findByText(/Saved as an agentic plan/);

    const planCard = (await screen.findAllByTestId(/^plan-/))[0];
    expect(screen.getByRole("heading", { name: "Saved Agentic Plans (1)" })).toBeInTheDocument();
    expect(within(planCard).getByRole("button", { name: "Execute now" })).toBeDisabled();
    await user.click(within(planCard).getByRole("button", { name: "Refresh & Validate" }));
    await within(planCard).findByText("STILL VALID");
    expect(within(planCard).getByRole("button", { name: "Execute now" })).toBeEnabled();
    await user.click(within(planCard).getByRole("button", { name: "Discard" }));
    await screen.findByRole("heading", { name: "Saved Agentic Plans (0)" });

    const audit = listAudit(api.store, { source: "ai" });
    expect(audit.find((e) => e.action === "agent.run")?.actor).toBe("alice");
    expect(audit.find((e) => e.action === "inbox.approve")?.actor).toBe("alice");
  });

  it("saves persona changes", async () => {
    const user = userEvent.setup();
    await renderCockpit();
    await user.click(await screen.findByRole("button", { name: "VP of Supply Chain" }));
    await user.click(screen.getByRole("button", { name: /Save persona/ }));
    await waitFor(async () => expect((await api.call("GET", "/api/ai/config")).body.persona.experience_level).toBe("VP of Supply Chain"));
    expect(screen.queryByRole("button", { name: /Save persona/ })).not.toBeInTheDocument();
  });

  it("builds a flow in the modeler, simulates, publishes, and shows its tile", async () => {
    const user = userEvent.setup();
    await renderCockpit();
    await user.click(screen.getByRole("tab", { name: "2 · Process Modeler" }));
    await user.click(await screen.findByRole("button", { name: "+ New agent" }));
    const publish = screen.getByRole("button", { name: "Publish to Cockpit" });
    expect(publish).toBeDisabled();
    const name = screen.getByLabelText("Flow name");
    await user.clear(name);
    await user.type(name, "Buyer test flow");
    expect(screen.getByText("unsaved edits")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Simulate/ }));
    await screen.findByText("PASSED — publish unlocked");
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish to Cockpit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Publish to Cockpit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled());
    await user.click(screen.getByRole("tab", { name: "1 · Command Center" }));
    expect(await screen.findByText("Buyer test flow")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "3 · Agentic History" }));
    expect(await screen.findByRole("heading", { name: "Agentic History (1 runs)" })).toBeInTheDocument();
  });

  it("surfaces a flow validation error from the server", async () => {
    const user = userEvent.setup();
    await renderCockpit();
    await user.click(screen.getByRole("tab", { name: "2 · Process Modeler" }));
    await user.click(await screen.findByRole("button", { name: "+ New agent" }));
    await user.clear(screen.getByLabelText("Flow name"));
    await user.click(screen.getByRole("button", { name: /Simulate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/name must be 1-120/);
  });
});
