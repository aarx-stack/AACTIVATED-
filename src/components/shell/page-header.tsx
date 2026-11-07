import type * as React from "react";

/**
 * Page title in the Obsidian Glass style: large bold title, one-line description,
 * optional badge beside the title and actions on the right.
 * `eyebrow` is kept for context in code but not rendered (the concepts have no eyebrow).
 */
export function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] leading-tight font-bold tracking-tight sm:text-[32px]">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
