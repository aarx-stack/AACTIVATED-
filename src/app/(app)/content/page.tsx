import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentChannel } from "@/generated/prisma/enums";
import { type ContentStatus } from "@/generated/prisma/enums";
import { CHANNEL, CONTENT_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getContentCalendar, monthKey, parseMonth } from "@/server/queries/content";

export const metadata: Metadata = { title: "Content Studio" };

const CHANNEL_DOT: Record<ContentChannel, string> = {
  FACEBOOK: "bg-[#1877f2]",
  INSTAGRAM: "bg-[#d62976]",
  TIKTOK: "bg-chart-4",
  YOUTUBE: "bg-[#e62117]",
  EMAIL: "bg-primary",
};

const TONE_TEXT = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

const STATUS_ORDER: ContentStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED"];
const SOCIAL: ContentChannel[] = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"];

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; channel?: string }>;
}) {
  const user = await requirePagePermission("content_studio.view");
  const params = await searchParams;
  const month = parseMonth(params.month);
  const channel = SOCIAL.includes(params.channel as ContentChannel)
    ? (params.channel as ContentChannel)
    : undefined;
  const { scheduled, unscheduled } = await getContentCalendar(user, month, channel);

  const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lead = (month.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const todayKey = new Date().toDateString();
  const qs = (o: { month?: string; channel?: string }) => {
    const p = new URLSearchParams();
    if (o.month) p.set("month", o.month);
    if (o.channel) p.set("channel", o.channel);
    return `/content?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={user.role === "PREMIUM_REP" ? "My content" : "All content"}
        title="Content Studio"
        description="Plan posts by channel. Drafts go through the compliance check and approval before they can be scheduled."
        actions={
          can(user.role, "content.create") && (
            <Button asChild>
              <Link href="/content/new">
                <Plus aria-hidden /> New post
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={qs({ month: monthKey(prev), channel })} aria-label="Previous month">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
            {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h2>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={qs({ month: monthKey(next), channel })} aria-label="Next month">
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <nav aria-label="Filter by channel" className="flex flex-wrap gap-1">
          {[undefined, ...SOCIAL].map((c) => (
            <Link
              key={c ?? "all"}
              href={qs({ month: monthKey(month), channel: c })}
              aria-current={channel === c ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium",
                channel === c
                  ? "border-border-strong bg-info-soft text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c && <span className={cn("size-2 rounded-pill", CHANNEL_DOT[c])} aria-hidden />}
              {c ? CHANNEL[c] : "All channels"}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Status legend">
        {STATUS_ORDER.map((s) => (
          <Badge key={s} tone={CONTENT_STATUS[s].tone}>
            {s === "APPROVED" ? "Approved" : CONTENT_STATUS[s].label}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <Card className="overflow-hidden">
          <div
            className="grid grid-cols-7 border-b border-border text-center text-xs font-medium text-muted-foreground"
            aria-hidden
          >
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
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
                    className="hidden min-h-24 border-b border-border bg-surface-muted/40 sm:block sm:border-r"
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
                    "min-h-24 border-b border-border p-1.5 sm:border-r",
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
                      "mb-1 text-xs tabular-nums",
                      isToday ? "font-semibold text-primary" : "text-muted-foreground",
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
                          href={`/content/${it.id}`}
                          className="block rounded-lg border border-border bg-surface-solid px-1.5 py-1 text-xs hover:border-border-strong"
                          title={`${it.title} · ${CONTENT_STATUS[it.status].label}`}
                        >
                          <span className="flex items-center gap-1">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-pill",
                                CHANNEL_DOT[it.channel],
                              )}
                              aria-hidden
                            />
                            <span className="truncate">{it.title}</span>
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 block truncate",
                              TONE_TEXT[CONTENT_STATUS[it.status].tone],
                            )}
                          >
                            {CONTENT_STATUS[it.status].label.replace(" · ready to schedule", "")}
                            {it.rep && user.role !== "PREMIUM_REP" ? ` · ${it.rep.name}` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Not yet dated</CardTitle>
            <CardDescription>Drafts and approved posts without a date.</CardDescription>
          </CardHeader>
          <CardContent>
            {unscheduled.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="unscheduled">
                {unscheduled.map((it) => (
                  <li key={it.id}>
                    <Link
                      href={`/content/${it.id}`}
                      className="block rounded-control border border-border p-2 text-sm hover:border-border-strong"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn("size-2 shrink-0 rounded-pill", CHANNEL_DOT[it.channel])}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{it.title}</span>
                      </span>
                      <Badge tone={CONTENT_STATUS[it.status].tone} className="mt-1">
                        {CONTENT_STATUS[it.status].label}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
