"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** A select that writes its value to a URL search param (and keeps the others). */
export function ParamSelect({
  param,
  value,
  label,
  options,
  id,
}: {
  param: string;
  value: string;
  label: string;
  options: { value: string; label: string }[];
  id: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set(param, e.target.value);
          start(() => router.replace(`${pathname}?${next.toString()}`));
        }}
        className="glass h-9 rounded-control px-3 pr-8 text-sm font-medium text-foreground focus-visible:border-border-strong"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
