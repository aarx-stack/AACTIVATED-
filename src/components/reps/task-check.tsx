"use client";

import { useOptimistic, useTransition } from "react";
import { toggleTaskAction } from "@/app/(app)/my-team/actions";
import { cn } from "@/lib/utils";

export function TaskCheck({
  id,
  title,
  done,
  meta,
}: {
  id: string;
  title: string;
  done: boolean;
  meta: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-control px-2 py-2 hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={optimistic}
        onChange={(e) => {
          const next = e.target.checked;
          start(async () => {
            setOptimistic(next);
            await toggleTaskAction(id, next);
          });
        }}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className={cn("block text-sm", optimistic && "text-muted-foreground line-through")}>
          {title}
        </span>
        <span className="block text-xs text-subtle-foreground">{meta}</span>
      </span>
    </label>
  );
}
