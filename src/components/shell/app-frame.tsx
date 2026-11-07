"use client";

import { Bell, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clock } from "./clock";
import { SidebarNav } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type ShellUser } from "./user-menu";

function Brand() {
  return (
    <div className="px-2 pt-1">
      <Link
        href="/"
        className="block rounded-control py-1 text-[17px] leading-tight font-extrabold tracking-[0.02em] text-foreground"
      >
        AACTIVATED AI BRAIN
      </Link>
      <div
        aria-hidden
        className="mt-4 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent"
      />
    </div>
  );
}

export interface BrainStatus {
  online: boolean;
  label: string;
}

export function AppFrame({
  user,
  allowedHrefs,
  badges,
  unreadCount,
  brain,
  children,
}: {
  user: ShellUser;
  allowedHrefs: string[];
  badges: Record<string, number>;
  unreadCount: number;
  brain: BrainStatus;
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

      {/* Desktop: floating glass sidebar */}
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh w-[var(--sidebar-width)] shrink-0 p-3 lg:block"
      >
        <div className="glass flex h-full flex-col gap-5 overflow-y-auto rounded-[22px] bg-sidebar p-4">
          <Brand />
          <SidebarNav allowedHrefs={allowedHrefs} badges={badges} />
        </div>
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
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="glass relative m-3 flex h-[calc(100%-1.5rem)] w-[min(85vw,var(--sidebar-width))] flex-col gap-5 overflow-y-auto rounded-[22px] bg-surface-solid p-4">
            <div className="flex items-start justify-between">
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
            <SidebarNav
              allowedHrefs={allowedHrefs}
              badges={badges}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-[var(--page-gutter)] pt-4 sm:px-6 lg:px-8">
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
          <span className="text-[13px] font-extrabold tracking-[0.02em] whitespace-nowrap lg:hidden">
            AACTIVATED AI BRAIN
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/status"
              className="glass hidden items-center gap-2 rounded-pill px-4 py-2 text-xs font-medium md:flex"
              data-testid="brain-online"
            >
              <span
                className={cn(
                  "size-2 rounded-pill",
                  brain.online ? "live-dot bg-success text-success" : "bg-warning",
                )}
                aria-hidden
              />
              <span className="font-semibold">{brain.label}</span>
              <Clock />
            </Link>
            <Button variant="secondary" size="icon" asChild className="relative rounded-control">
              <Link
                href="/notifications"
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
              >
                <Bell aria-hidden />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-pill fill-primary px-1 text-[10px] leading-5 font-bold tabular-nums">
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
          className="flex-1 px-[var(--page-gutter)] pt-2 pb-8 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
