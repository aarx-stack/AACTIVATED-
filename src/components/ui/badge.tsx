import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border border-neutral-line bg-neutral-soft text-muted-foreground",
        info: "border border-info-line bg-info-soft text-info",
        success: "border border-success-line bg-success-soft text-success",
        warning: "border border-warning-line bg-warning-soft text-warning",
        danger: "border border-danger-line bg-danger-soft text-danger",
        violet: "border border-violet/50 bg-violet-soft text-violet",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
