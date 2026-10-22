"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { post } from "@/lib/api/request";
import { AuthCard } from "./AuthCard";

export function ResetPasswordForm({ token: initialToken = "" }: { token?: string }) {
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post("/api/auth/reset", { token, password });
      setDone(true);
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      setError(m.includes("8 characters") ? "Password must be at least 8 characters." : "Invalid or expired reset token.");
    }
  }

  return (
    <AuthCard title="Reset password">
      {done ? (
        <p className="auth__hint" role="status">
          Password updated. <Link href="/login">Sign in</Link>.
        </p>
      ) : (
        <form onSubmit={submit} className="auth__form">
          <label className="auth__label">
            Reset token
            <input className="auth__input" value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <label className="auth__label">
            New password
            <input className="auth__input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary">
            Update password
          </button>
        </form>
      )}
    </AuthCard>
  );
}
