import Link from "next/link";
import type { ReactNode } from "react";
import { labelOf } from "@/lib/labels";

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink md:text-3xl">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm text-soft">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  lit = false,
  title,
  actions,
  id,
}: {
  children: ReactNode;
  className?: string;
  lit?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`glass ${lit ? "glass-lit" : ""} p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE_CLASS: Record<string, string> = {
  blue: "badge-blue",
  cyan: "badge-cyan",
  violet: "badge-violet",
  green: "badge-green",
  amber: "badge-amber",
  red: "badge-red",
  gray: "",
};

export function Badge({ tone = "gray", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${TONE_CLASS[tone] ?? ""}`} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({
  map,
  value,
  prefix,
}: {
  map: Record<string, [string, "blue" | "cyan" | "violet" | "green" | "amber" | "red" | "gray"]>;
  value: string | null | undefined;
  prefix?: string;
}) {
  const [label, tone] = labelOf(map, value);
  return (
    <Badge tone={tone}>
      {prefix ? <span className="opacity-70">{prefix}</span> : null}
      {label}
    </Badge>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
      <div className="mb-3 h-10 w-10 rounded-xl border border-cyan/40 bg-accent/10 shadow-[0_0_24px_-8px_rgba(53,231,255,0.8)]" />
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode; title?: string }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function FictionalBadge() {
  return <Badge tone="violet">FICTIONAL DEMO DATA</Badge>;
}

export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-1" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="tab" aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function AddressBlock({ lines }: { lines: string[] }) {
  if (!lines.length) return <span className="text-muted">No address</span>;
  return (
    <address className="not-italic leading-relaxed">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </address>
  );
}
