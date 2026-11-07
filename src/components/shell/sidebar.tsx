"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({
  allowedHrefs,
  onNavigate,
}: {
  allowedHrefs: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = new Set(allowedHrefs);

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => allowed.has(i.href));
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.14em] text-subtle-foreground uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-info-soft text-foreground shadow-glow"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          active
                            ? "text-primary"
                            : "text-subtle-foreground group-hover:text-foreground",
                        )}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
