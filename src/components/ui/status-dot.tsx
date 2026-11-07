import { cn } from "@/lib/utils";

const tones = {
  success: "text-success bg-success",
  warning: "text-warning bg-warning",
  danger: "text-danger bg-danger",
  info: "text-info bg-info",
  neutral: "text-subtle-foreground bg-subtle-foreground",
} as const;

export type StatusTone = keyof typeof tones;

export function StatusDot({
  tone,
  live = false,
  className,
}: {
  tone: StatusTone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 rounded-pill", tones[tone], live && "live-dot", className)}
    />
  );
}
