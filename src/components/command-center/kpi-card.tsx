import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { Card } from "@/components/ui/card";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-control bg-info-soft text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
