"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveThemePreference } from "@/app/(app)/actions";

/** Switches dark/light and saves the choice on the user record. */
export function ThemeToggle({ persist = true }: { persist?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [, startTransition] = useTransition();
  const isDark = resolvedTheme !== "light";

  function toggle() {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    if (persist)
      startTransition(() => void saveThemePreference(next === "dark" ? "DARK" : "LIGHT"));
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      data-testid="theme-toggle"
    >
      <Sun className="hidden dark:block" aria-hidden />
      <Moon className="block dark:hidden" aria-hidden />
    </Button>
  );
}
