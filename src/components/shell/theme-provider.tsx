"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

export function ThemeProvider({
  children,
  defaultTheme,
  storageKey,
}: {
  children: React.ReactNode;
  defaultTheme: "dark" | "light" | "system";
  storageKey: string;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      storageKey={storageKey}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
