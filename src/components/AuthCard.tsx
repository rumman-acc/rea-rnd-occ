import type { ReactNode } from "react";
import { appConfig } from "@/config/branding";
import { BrandMark } from "./BrandMark";

/** Centered card used by the login, forgot-password and reset-password pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <BrandMark />
          <div>
            <div className="auth__product">{appConfig.productName}</div>
            <div className="auth__tagline">Operations Control Center</div>
          </div>
        </div>
        <h1 className="auth__title">{title}</h1>
        {children}
      </div>
    </div>
  );
}
