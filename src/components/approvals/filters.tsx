"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

const selectClass =
  "glass h-10 rounded-pill px-4 pr-8 text-sm font-medium text-foreground focus-visible:border-border-strong";

export function ApprovalFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [, start] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("selected");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter approvals">
      <form
        className="glass flex min-w-60 flex-1 items-center gap-2 rounded-pill px-4"
        onSubmit={(e) => {
          e.preventDefault();
          update("q", q.trim());
        }}
      >
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <label htmlFor="approval-search" className="sr-only">
          Search by title, type or owner
        </label>
        <input
          id="approval-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => update("q", q.trim())}
          placeholder="Search by title, type or owner…"
          className="h-10 w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </form>
      <label className="sr-only" htmlFor="f-status">
        Status
      </label>
      <select
        id="f-status"
        className={selectClass}
        value={params.get("tab") ?? "pending"}
        onChange={(e) => update("tab", e.target.value)}
      >
        <option value="pending">Status: Pending</option>
        <option value="approved">Status: Approved</option>
        <option value="rejected">Status: Rejected</option>
        <option value="all">Status: All</option>
      </select>
      <label className="sr-only" htmlFor="f-type">
        Type
      </label>
      <select
        id="f-type"
        className={selectClass}
        value={params.get("type") ?? ""}
        onChange={(e) => update("type", e.target.value)}
      >
        <option value="">Type: All</option>
        <option value="SOCIAL_POST">Social post</option>
        <option value="EMAIL">Email</option>
        <option value="DIRECT_MESSAGE">Direct message</option>
        <option value="SPEND">Spend</option>
        <option value="PROJECT_LAUNCH">Project launch</option>
        <option value="LEGAL">Legal</option>
      </select>
      <label className="sr-only" htmlFor="f-risk">
        Risk
      </label>
      <select
        id="f-risk"
        className={selectClass}
        value={params.get("risk") ?? ""}
        onChange={(e) => update("risk", e.target.value)}
      >
        <option value="">Risk: All</option>
        <option value="LOW">Low</option>
        <option value="MEDIUM">Medium</option>
        <option value="HIGH">High</option>
        <option value="CRITICAL">Critical</option>
      </select>
    </div>
  );
}
