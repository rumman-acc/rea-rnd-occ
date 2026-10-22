import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appConfig } from "@/config/branding";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: `${appConfig.productName} — Operations Control Center`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
