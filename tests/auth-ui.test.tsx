import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { LoginForm } from "@/components/LoginForm";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { installApi, type InstalledApi } from "./support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

describe("login page (stub authentication)", () => {
  it("signs in with the demo account and navigates to the requested page", async () => {
    const onSuccess = vi.fn();
    render(<LoginForm next="/orders" onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText("Email"), "alex.morgan@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "demo1234");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("/orders"));
  });

  it("shows an error for bad credentials and does not navigate", async () => {
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText("Email"), "alex.morgan@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/", "//evil.example/"])("never follows an off-site next target (%s)", async (next) => {
    const onSuccess = vi.fn();
    render(<LoginForm next={next} onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText("Email"), "alex.morgan@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "demo1234");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("/"));
  });
});

describe("forgot and reset password", () => {
  it("issues a demo token, then resets the password so the new one signs in", async () => {
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email"), "alex.morgan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Request reset" }));
    const link = await screen.findByRole("link", { name: "Open the reset page" });
    const token = new URL(link.getAttribute("href")!, "http://x").searchParams.get("token")!;
    expect(screen.getByRole("status")).toHaveTextContent("no email is sent");

    render(<ResetPasswordForm token={token} />);
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-pass");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText(/Password updated/)).toBeInTheDocument();
    expect((await api.call("POST", "/api/auth/login", { email: "alex.morgan@example.com", password: "brand-new-pass" })).status).toBe(200);
  });

  it("does not reveal whether an account exists", async () => {
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Request reset" }));
    expect(await screen.findByRole("status")).toHaveTextContent("If that account exists");
    expect(screen.queryByRole("link", { name: "Open the reset page" })).not.toBeInTheDocument();
  });

  it("rejects a short password and a bad token", async () => {
    render(<ResetPasswordForm token="bad-token" />);
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "long-enough-pw");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid or expired reset token."));
  });
});
