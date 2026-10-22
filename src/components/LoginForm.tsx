"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { post } from "@/lib/api/request";
import { AuthCard } from "./AuthCard";

/** Stub sign-in (SPEC-FULL D8). `onSuccess` defaults to a full navigation so the proxy sees the new cookie. */
export function LoginForm({
  next = "/",
  onSuccess = (to: string) => window.location.assign(to),
}: {
  next?: string;
  onSuccess?: (to: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/login", { email, password });
      // Only same-site relative paths are followed after sign-in.
      onSuccess(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m.includes("401") ? "Invalid email or password." : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit} className="auth__form">
        <label className="auth__label">
          Email
          <input className="auth__input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="auth__label">
          Password
          <input className="auth__input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Sign in
        </button>
        <Link href="/forgot-password" className="auth__link">
          Forgot password?
        </Link>
        <p className="auth__hint">Demo account: alex.morgan@example.com / demo1234</p>
      </form>
    </AuthCard>
  );
}
