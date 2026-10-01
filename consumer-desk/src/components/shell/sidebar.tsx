"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Command Center", icon: "M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6Zm10-18v6h8V3h-8Z" },
  { href: "/tracker", label: "Dispute Tracker", icon: "M4 5h16M4 10h16M4 15h10M4 20h7" },
  { href: "/clients", label: "Clients", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-12 9c0-3 4-5 8-5s8 2 8 5" },
  { href: "/letters", label: "Letters", icon: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h7" },
  { href: "/templates", label: "Templates", icon: "M4 4h16v6H4V4Zm0 10h7v6H4v-6Zm10 0h6v6h-6v-6Z" },
  { href: "/documents", label: "Documents", icon: "M7 3h7l5 5v13H7V3Zm7 0v5h5" },
  { href: "/responses", label: "Response Center", icon: "M3 7l9 6 9-6M3 7v10h18V7M3 7l9-4 9 4" },
  { href: "/follow-ups", label: "Follow-ups", icon: "M12 7v5l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { href: "/analytics", label: "Analytics", icon: "M4 20V10m6 10V4m6 16v-7m6 7H2" },
  { href: "/test-center", label: "LetterStream Test Center", icon: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" },
  { href: "/audit", label: "Audit Log", icon: "M5 4h14v16H5V4Zm3 4h8M8 12h8M8 16h5" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
];

function subscribe(callback: () => void) {
  window.addEventListener("cd-sidebar", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("cd-sidebar", callback);
    window.removeEventListener("storage", callback);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("cd.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ appName }: { appName: string }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    try {
      // Per-viewer UI convenience only; no records are stored in the browser.
      localStorage.setItem("cd.sidebar", collapsed ? "open" : "collapsed");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event("cd-sidebar"));
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const links = (compact: boolean) => (
    <ul className="space-y-1">
      {NAV.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={() => setMobileOpen(false)}
            title={compact ? item.label : undefined}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(item.href)
                ? "bg-accent/15 text-ink shadow-[inset_0_0_0_1px_rgba(53,231,255,0.35),0_0_20px_-10px_rgba(53,231,255,0.9)]"
                : "text-muted hover:bg-white/5 hover:text-ink"
            }`}
          >
            <Icon d={item.icon} />
            <span className={compact ? "sr-only" : ""}>{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        type="button"
        className="btn btn-sm fixed left-3 top-3 z-50 md:hidden"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileOpen}
        aria-controls="mobile-nav"
        onClick={() => setMobileOpen((o) => !o)}
        data-testid="mobile-nav-toggle"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          {mobileOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}
      <nav
        id="mobile-nav"
        aria-label="Main"
        className={`fixed inset-y-0 left-0 z-40 w-72 transform border-r border-white/10 bg-[#0a1120] p-4 pt-16 transition-transform md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {links(false)}
      </nav>

      <nav
        aria-label="Main"
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-[#080d19]/80 p-3 backdrop-blur md:flex ${
          collapsed ? "w-[76px]" : "w-64"
        } transition-[width] duration-200`}
      >
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <Link href="/" className={`flex items-center gap-2 ${collapsed ? "sr-only" : ""}`}>
            <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-cyan shadow-[0_0_18px_-4px_rgba(53,231,255,0.9)]" />
            <span className="truncate text-sm font-bold tracking-wide">{appName}</span>
          </Link>
          <button type="button" className="btn btn-sm" onClick={toggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{links(collapsed)}</div>
      </nav>
    </>
  );
}
