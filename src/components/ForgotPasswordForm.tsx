"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { post } from "@/lib/api/request";
import { AuthCard } from "./AuthCard";

/** Request a reset token. No email is sent in this build: the token is shown on screen (demo only). */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ token: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await post<{ token: string | null }>("/api/auth/forgot", { email }));
    } catch {
      setError("Could not process the request. Try again.");
    }
  }

  return (
    <AuthCard title="Forgot password">
      <form onSubmit={submit} className="auth__form">
        <label className="auth__label">
          Email
          <input className="auth__input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary">
          Request reset
        </button>
        {result && (
          <p className="auth__hint" role="status">
            {result.token ? (
              <>
                Demo only — no email is sent. <Link href={`/reset-password?token=${result.token}`}>Open the reset page</Link>.
              </>
            ) : (
              "If that account exists, a reset has been issued."
            )}
          </p>
        )}
        <Link href="/login" className="auth__link">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
