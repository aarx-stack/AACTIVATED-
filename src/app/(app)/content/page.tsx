import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickCaptionEditor } from "@/components/content/quick-caption-editor";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ContentChannel, ContentStatus } from "@/generated/prisma/enums";
import { CHANNEL, CONTENT_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { splitBody } from "@/server/content/studio";
import {
  getContentCalendar,
  getContentDetail,
  monthKey,
  parseMonth,
} from "@/server/queries/content";

export const metadata: Metadata = { title: "Content Studio" };

/** Placeholder artwork per channel until real media is attached. */
const CHANNEL_ART: Record<ContentChannel, string> = {
  FACEBOOK: "bg-[linear-gradient(135deg,#1e3a8a,#3b82f6_55%,#93c5fd)]",
  INSTAGRAM: "bg-[linear-gradient(135deg,#7c3aed,#db2777_55%,#f59e0b)]",
  TIKTOK: "bg-[linear-gradient(135deg,#0f172a,#06b6d4_55%,#ec4899)]",
  YOUTUBE: "bg-[linear-gradient(135deg,#450a0a,#dc2626_55%,#fca5a5)]",
  EMAIL: "bg-[linear-gradient(135deg,#0c4a6e,#0ea5e9)]",
};
const CHANNEL_DOT: Record<ContentChannel, string> = {
  FACEBOOK: "bg-[#3b82f6]",
  INSTAGRAM: "bg-[#db2777]",
  TIKTOK: "bg-[#06b6d4]",
  YOUTUBE: "bg-[#ef4444]",
  EMAIL: "bg-primary",
};
const LEGEND: { status: ContentStatus; label: string; dot: string }[] = [
  { status: "DRAFT", label: "Draft", dot: "bg-subtle-foreground" },
  { status: "IN_REVIEW", label: "In Review", dot: "bg-warning" },
  { status: "APPROVED", label: "Approved", dot: "bg-success" },
  { status: "SCHEDULED", label: "Scheduled", dot: "bg-info" },
];
const SOCIAL: ContentChannel[] = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"];
const SHORT_STATUS: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
};

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; channel?: string; selected?: string }>;
}) {
  const user = await requirePagePermission("content_studio.view");
  const params = await searchParams;
  const month = parseMonth(params.month);
  const channel = SOCIAL.includes(params.channel as ContentChannel)
    ? (params.channel as ContentChannel)
    : undefined;
  const all = await getContentCalendar(user, month);
  const scheduled = channel ? all.scheduled.filter((s) => s.channel === channel) : all.scheduled;
  const unscheduled = channel
    ? all.unscheduled.filter((s) => s.channel === channel)
    : all.unscheduled;
  const selectedId = params.selected ?? scheduled[0]?.id ?? unscheduled[0]?.id;
  const selected = selectedId ? await getContentDetail(user, selectedId) : null;

  const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lead = month.getDay(); // Sunday-first grid, as in the concept
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const todayKey = new Date().toDateString();
  const qs = (o: { month?: string; channel?: string; selected?: string }) => {
    const p = new URLSearchParams();
    if (o.month) p.set("month", o.month);
    if (o.channel) p.set("channel", o.channel);
    if (o.selected) p.set("selected", o.selected);
    return `/content?${p.toString()}`;
  };
  const mk = monthKey(month);
  const editable =
    selected &&
    (selected.status === "DRAFT" || selected.status === "REJECTED") &&
    can(user.role, "content.create");
  const parts = selected ? splitBody(selected.body) : null;

  return (
    <>
      <PageHeader
        title="Content Studio"
        description="Plan, create and manage your social media content with AI. Every post is checked for compliance and approved before it can be scheduled."
        actions={
          can(user.role, "content.create") && (
            <>
              <Button asChild>
                <Link href={user.role === "PREMIUM_REP" ? "/my-team" : "/command-center"}>
                  <Sparkles aria-hidden /> Create with AI
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/content/new">
                  <Plus aria-hidden /> New Post
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button asChild variant="secondary" size="icon-sm" className="rounded-control">
                <Link href={qs({ month: monthKey(prev), channel })} aria-label="Previous month">
                  <ChevronLeft aria-hidden />
                </Link>
              </Button>
              <h2 className="min-w-44 text-center text-xl font-bold" aria-live="polite">
                {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <Button asChild variant="secondary" size="icon-sm" className="rounded-control">
                <Link href={qs({ month: monthKey(next), channel })} aria-label="Next month">
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            </div>
            <ul
              className="flex flex-wrap items-center gap-3 tile rounded-pill px-3 py-1.5 text-xs"
              aria-label="Status legend"
            >
              {LEGEND.map((l) => (
                <li key={l.status} className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-pill", l.dot)} aria-hidden />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label="Filter by channel" className="mb-4 flex flex-wrap gap-2">
            {[undefined, ...SOCIAL].map((c) => {
              const count = c
                ? all.scheduled.filter((s) => s.channel === c).length
                : all.scheduled.length;
              const active = channel === c;
              return (
                <Link
                  key={c ?? "all"}
                  href={qs({ month: mk, channel: c })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-semibold",
                    active
                      ? "border-transparent fill-primary"
                      : "tile text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c && <span className={cn("size-2 rounded-pill", CHANNEL_DOT[c])} aria-hidden />}
                  {c ? CHANNEL[c] : "All"} ({count})
                </Link>
              );
            })}
          </nav>

          <div className="overflow-hidden tile">
            <div
              className="grid grid-cols-7 bg-surface-muted text-center text-xs font-semibold"
              aria-hidden
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <ol className="grid grid-cols-1 sm:grid-cols-7" data-testid="calendar">
              {Array.from({ length: cells }, (_, i) => {
                const day = i - lead + 1;
                if (day < 1 || day > daysInMonth) {
                  return (
                    <li
                      key={i}
                      aria-hidden
                      className="hidden min-h-28 border-t border-r border-border opacity-40 sm:block"
                    />
                  );
                }
                const date = new Date(month.getFullYear(), month.getMonth(), day);
                const items = scheduled.filter(
                  (s) => s.scheduledFor && s.scheduledFor.getDate() === day,
                );
                const isToday = date.toDateString() === todayKey;
                return (
                  <li
                    key={i}
                    className={cn(
                      "min-h-28 border-t border-r border-border p-1.5",
                      items.length === 0 && "hidden sm:block",
                    )}
                    aria-label={date.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  >
                    <p
                      className={cn(
                        "mb-1 text-xs font-semibold tabular-nums",
                        isToday && "text-cyan",
                      )}
                    >
                      <span className="sm:hidden">
                        {date.toLocaleDateString("en-US", { weekday: "short" })}{" "}
                      </span>
                      {day}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {items.map((it) => (
                        <li key={it.id}>
                          <Link
                            href={qs({ month: mk, channel, selected: it.id })}
                            aria-current={it.id === selectedId ? "true" : undefined}
                            title={it.title}
                            className={cn(
                              "glass flex gap-1.5 rounded-[10px] p-1 text-[11px] leading-tight",
                              it.id === selectedId && "border-[var(--border-strong)] shadow-glow",
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "size-7 shrink-0 rounded-[6px]",
                                CHANNEL_ART[it.channel],
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">
                                {CHANNEL[it.channel]}
                              </span>
                              <Badge
                                tone={CONTENT_STATUS[it.status].tone}
                                className="mt-0.5 px-1.5 py-0 text-[10px]"
                              >
                                {SHORT_STATUS[it.status]}
                              </Badge>
                              <span className="mt-0.5 block text-muted-foreground tabular-nums">
                                {it.scheduledFor?.toLocaleTimeString("en-US", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>

          {unscheduled.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Not yet dated</h3>
              <ul className="flex flex-wrap gap-2" data-testid="unscheduled">
                {unscheduled.map((it) => (
                  <li key={it.id}>
                    <Link
                      href={qs({ month: mk, channel, selected: it.id })}
                      className={cn(
                        "flex items-center gap-2 tile px-2.5 py-1.5 text-xs",
                        it.id === selectedId && "border-[var(--border-strong)]",
                      )}
                    >
                      <span
                        className={cn("size-2 rounded-pill", CHANNEL_DOT[it.channel])}
                        aria-hidden
                      />
                      <span className="max-w-48 truncate font-medium">{it.title}</span>
                      <Badge
                        tone={CONTENT_STATUS[it.status].tone}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {SHORT_STATUS[it.status]}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card
          className="flex flex-col gap-4 p-5 2xl:sticky 2xl:top-4 2xl:self-start"
          aria-label="AI Caption Editor"
        >
          <div>
            <h2 className="text-lg font-semibold">AI Caption Editor</h2>
            <p className="text-xs text-muted-foreground">
              Generate, refine and optimize captions for your posts with AI.
            </p>
          </div>
          {!selected || !parts ? (
            <p className="text-sm text-muted-foreground">Select a post on the calendar.</p>
          ) : (
            <>
              <div className="flex gap-3">
                <span
                  aria-hidden
                  className={cn("size-24 shrink-0 rounded-[12px]", CHANNEL_ART[selected.channel])}
                />
                <dl className="grid flex-1 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
                  <dt className="col-span-2 text-sm font-semibold">Post Details</dt>
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd className="tile rounded-pill px-2.5 py-1 font-semibold">
                    {CHANNEL[selected.channel]}
                  </dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge tone={CONTENT_STATUS[selected.status].tone}>
                      {SHORT_STATUS[selected.status]}
                    </Badge>
                  </dd>
                  <dt className="text-muted-foreground">Date</dt>
                  <dd className="flex items-center gap-1 tile rounded-pill px-2.5 py-1">
                    <CalendarDays className="size-3" aria-hidden />
                    {selected.scheduledFor
                      ? selected.scheduledFor.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Not dated"}
                  </dd>
                </dl>
              </div>
              <p className="text-sm font-semibold">{selected.title}</p>
              {editable ? (
                <QuickCaptionEditor
                  key={selected.id}
                  post={{
                    id: selected.id,
                    title: selected.title,
                    caption: parts.caption,
                    hashtags: parts.hashtags,
                    channel: selected.channel,
                    plannedFor: selected.scheduledFor
                      ? selected.scheduledFor.toISOString().slice(0, 10)
                      : "",
                  }}
                />
              ) : (
                <>
                  <p className="tile p-3 text-sm whitespace-pre-line">{parts.caption}</p>
                  {parts.hashtags.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {parts.hashtags.map((t) => (
                        <li key={t} className="tile rounded-pill px-2.5 py-1 text-xs font-semibold">
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" aria-hidden />
                    {selected.status === "IN_REVIEW"
                      ? "Locked while in review."
                      : selected.status === "APPROVED"
                        ? "Approved: ready to schedule."
                        : "Approved version. Changes need a new approval."}
                  </p>
                </>
              )}
              <Button asChild variant="outline">
                <Link href={`/content/${selected.id}`}>Open post</Link>
              </Button>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
