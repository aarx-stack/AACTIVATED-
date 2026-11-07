import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-control border border-border bg-surface-muted px-3 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:border-border-strong disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
