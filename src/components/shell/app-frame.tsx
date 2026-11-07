"use client";

import { Bell, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type ShellUser } from "./user-menu";

function Brand() {
  return (
    <Link href="/" className="block rounded-control px-3 py-1">
      <span className="block text-[13px] leading-tight font-semibold tracking-[0.18em] text-foreground">
        AACTIVATED
      </span>
      <span className="block text-[11px] leading-tight font-medium tracking-[0.24em] text-primary">
        AI BRAIN
      </span>
    </Link>
  );
}

export function AppFrame({
  user,
  allowedHrefs,
  unreadCount,
  children,
}: {
  user: ShellUser;
  allowedHrefs: string[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="relative z-10 flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-dvh w-[var(--sidebar-width)] shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar px-3 py-5 backdrop-blur-xl lg:flex"
        aria-label="Sidebar"
      >
        <Brand />
        <SidebarNav allowedHrefs={allowedHrefs} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex h-full w-[min(85vw,var(--sidebar-width))] flex-col gap-6 overflow-y-auto border-r border-border bg-surface-solid px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X aria-hidden />
              </Button>
            </div>
            <SidebarNav allowedHrefs={allowedHrefs} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center gap-2 border-b border-border bg-background/70 px-[var(--page-gutter)] backdrop-blur-xl sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu aria-hidden />
          </Button>
          <span className="text-[11px] font-semibold tracking-[0.14em] whitespace-nowrap text-foreground lg:hidden">
            AACTIVATED AI BRAIN
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild>
              <Link
                href="/notifications"
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
                className="relative"
              >
                <Bell aria-hidden />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-pill bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            </Button>
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 px-[var(--page-gutter)] py-6 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
