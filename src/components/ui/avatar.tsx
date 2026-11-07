import { cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-info-soft text-xs font-semibold text-info",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
