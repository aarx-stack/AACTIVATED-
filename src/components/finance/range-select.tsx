"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

const OPTIONS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" },
];

export function RangeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  return (
    <>
      <label htmlFor="finance-range" className="sr-only">
        Period
      </label>
      <select
        id="finance-range"
        value={String(value)}
        aria-busy={pending}
        onChange={(e) => start(() => router.replace(`${pathname}?range=${e.target.value}`))}
        className="glass h-10 rounded-control px-4 pr-8 text-sm font-medium text-foreground focus-visible:border-border-strong"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
