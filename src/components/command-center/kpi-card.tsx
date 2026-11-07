import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface Delta {
  text: string;
  trend: "up" | "down" | "flat";
  /** Whether "up" is good (green) or bad. Defaults to good. */
  goodWhenUp?: boolean;
}

export function DeltaChip({ delta }: { delta: Delta }) {
  const good =
    delta.trend === "flat" ? null : (delta.trend === "up") === (delta.goodWhenUp ?? true);
  const Icon = delta.trend === "up" ? ArrowUp : delta.trend === "down" ? ArrowDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tile rounded-pill px-2.5 py-1 text-xs font-medium",
        good === null ? "text-muted-foreground" : good ? "text-success" : "text-warning",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {delta.text}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: Delta;
  icon: LucideIcon;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col gap-2 p-4", className)}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-7 shrink-0 text-cyan" strokeWidth={1.6} aria-hidden />
        <p className="text-sm leading-snug font-medium">{label}</p>
      </div>
      <p className="pl-1 text-[28px] leading-tight font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {children}
      {delta && (
        <div>
          <DeltaChip delta={delta} />
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
