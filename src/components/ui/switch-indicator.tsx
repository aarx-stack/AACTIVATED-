import { cn } from "@/lib/utils";

/**
 * A toggle-switch *display* for read-only booleans (e.g. the permission matrix,
 * which is defined in code). Not interactive; exposed as a checked/unchecked state.
 */
export function SwitchIndicator({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${on ? "allowed" : "not allowed"}`}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border transition-colors",
        on ? "border-transparent fill-primary" : "border-border bg-surface-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute size-3.5 rounded-pill bg-white shadow transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[2px] opacity-70",
        )}
      />
    </span>
  );
}
