import { cn } from "@/lib/utils";

const FILL = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

/** Accessible progress meter (role="meter"). Turns warning/danger past thresholds. */
export function Meter({
  value,
  max = 1,
  label,
  warnAt = 0.6,
  dangerAt = 0.75,
  tone,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  warnAt?: number;
  dangerAt?: number;
  /** Fixed color; overrides the threshold colors (use when higher is better). */
  tone?: "primary" | "success" | "warning" | "danger";
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const fill = tone
    ? FILL[tone]
    : ratio >= dangerAt
      ? "bg-danger"
      : ratio >= warnAt
        ? "bg-warning"
        : "bg-primary";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      className={cn("h-2 w-full overflow-hidden rounded-pill bg-surface-muted", className)}
    >
      <div
        className={cn("h-full rounded-pill transition-[width]", fill)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
