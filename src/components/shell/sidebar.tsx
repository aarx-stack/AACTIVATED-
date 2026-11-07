"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({
  allowedHrefs,
  badges = {},
  onNavigate,
}: {
  allowedHrefs: string[];
  badges?: Record<string, number>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = new Set(allowedHrefs);
  const items = NAV_ITEMS.filter((i) => allowed.has(i.href));

  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const count = badges[item.href] ?? 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-control border px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-[rgba(140,200,255,0.75)] fill-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-[18px] shrink-0",
                    active ? "text-white" : "text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden
                />
                <span className="flex-1 truncate">{item.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "flex min-w-6 items-center justify-center rounded-pill px-1.5 text-xs leading-6 font-semibold tabular-nums",
                      active ? "bg-white/25 text-white" : "fill-primary",
                    )}
                    aria-label={`${count} pending`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
