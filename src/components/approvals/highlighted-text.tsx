import { cn } from "@/lib/utils";

interface Flag {
  match: string;
  message: string;
  severity: string;
}

/** Renders text with every flagged phrase marked, so reviewers see exactly what the check found. */
export function HighlightedText({
  text,
  flags,
  className,
}: {
  text: string;
  flags: Flag[];
  className?: string;
}) {
  const ranges: { start: number; end: number; flag: Flag }[] = [];
  for (const flag of flags) {
    if (!flag.match) continue;
    const lower = text.toLowerCase();
    const needle = flag.match.toLowerCase();
    let from = 0;
    let at: number;
    while ((at = lower.indexOf(needle, from)) !== -1) {
      if (!ranges.some((r) => at < r.end && at + needle.length > r.start)) {
        ranges.push({ start: at, end: at + needle.length, flag });
      }
      from = at + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    const severe = r.flag.severity === "HIGH" || r.flag.severity === "CRITICAL";
    parts.push(
      <mark
        key={i}
        title={r.flag.message}
        className={cn(
          "rounded px-0.5 text-inherit underline decoration-2 underline-offset-2",
          severe ? "bg-danger-soft decoration-danger" : "bg-warning-soft decoration-warning",
        )}
      >
        {text.slice(r.start, r.end)}
        <span className="sr-only"> (flagged: {r.flag.message})</span>
      </mark>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <p className={cn("whitespace-pre-line", className)}>{parts}</p>;
}
