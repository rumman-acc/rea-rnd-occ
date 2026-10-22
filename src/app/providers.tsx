"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { DataProvider } from "@/data/provider";
import { createHttpPlanProvider } from "@/lib/api/planProvider";
import { defaultRuntime, RuntimeProvider } from "@/runtime/runtime";
import { PlanStateProvider } from "@/state/PlanState";
import { SessionProvider } from "@/state/Session";

/** Pages shown without the app shell and without loading the plan (stub authentication). */
export const AUTH_ROUTES = ["/login", "/forgot-password", "/reset-password"];

/**
 * Composition root. The only place the provider implementation is chosen: here, the HTTP
 * provider backed by this app's /api routes (SPEC ARC-003).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [provider] = useState(() => createHttpPlanProvider());
  const pathname = usePathname();
  const bare = AUTH_ROUTES.includes(pathname);
  return (
    <RuntimeProvider value={defaultRuntime}>
      <SessionProvider>
        {bare ? (
          children
        ) : (
          <DataProvider provider={provider}>
            <PlanStateProvider>
              <Shell>{children}</Shell>
            </PlanStateProvider>
          </DataProvider>
        )}
      </SessionProvider>
    </RuntimeProvider>
  );
}
