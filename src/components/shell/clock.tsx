"use client";

import { useEffect, useState } from "react";

function format(d: Date) {
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

/** Local date and time for the status pill. Renders nothing until mounted to avoid a hydration mismatch. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  if (!now) return null;
  const { date, time } = format(now);
  return (
    <span className="hidden items-center gap-2 tabular-nums sm:flex">
      <span aria-hidden className="h-4 w-px bg-border" />
      <span className="text-muted-foreground">{date}</span>
      <span className="font-semibold">{time}</span>
    </span>
  );
}
