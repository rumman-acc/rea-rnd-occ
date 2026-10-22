"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post } from "@/lib/api/request";

export interface SessionUser {
  id?: string;
  email: string;
  name: string;
  role: string;
}

export interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Session of the signed-in user (stub authentication, SPEC-FULL D8).
 * `initialUser` lets tests (or a server-rendered page) skip the lookup;
 * `onSignedOut` replaces the redirect to /login.
 */
export function SessionProvider({
  children,
  initialUser,
  onSignedOut,
}: {
  children: ReactNode;
  initialUser?: SessionUser | null;
  onSignedOut?: () => void;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);

  useEffect(() => {
    if (initialUser !== undefined) return;
    let live = true;
    get<{ user: SessionUser | null }>("/api/auth/session")
      .then((r) => live && setUser(r.user))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [initialUser]);

  const signOut = useCallback(async () => {
    try {
      await post("/api/auth/logout");
    } catch {
      // Even if the call fails, leave the client signed out.
    }
    setUser(null);
    if (onSignedOut) onSignedOut();
    else if (typeof window !== "undefined") window.location.assign("/login");
  }, [onSignedOut]);

  const value = useMemo(() => ({ user, loading, signOut }), [user, loading, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}
