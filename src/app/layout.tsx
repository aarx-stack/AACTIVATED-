import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type * as React from "react";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { getCurrentUser } from "@/server/auth/session";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AACTIVATED AI Brain", template: "%s | AACTIVATED AI Brain" },
  description: "Internal operating system for AACTIVATED RX.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0e1c" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

const THEME_MAP = { DARK: "dark", LIGHT: "light", SYSTEM: "system" } as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Keyed by user so signing in remounts it with that user's saved preference. */}
        <ThemeProvider
          key={user?.id ?? "signed-out"}
          defaultTheme={user ? THEME_MAP[user.theme] : "dark"}
          storageKey={user ? `aab-theme-${user.id}` : "aab-theme"}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
