import {
  Award,
  Bot,
  CalendarCheck2,
  CalendarDays,
  Circle,
  CircleCheck,
  GraduationCap,
  MessagesSquare,
  Send,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ActionButton,
  ActionForm,
  selectClass,
  textareaClass,
} from "@/components/forms/action-form";
import { TaskCheck } from "@/components/reps/task-check";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressRing } from "@/components/ui/progress-ring";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { APPROVAL_STATUS, CHANNEL, CONTENT_STATUS } from "@/lib/labels";
import { AGENT_STATUS } from "@/lib/status";
import { cn, formatRelativeTime, humanize } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getMyTeam } from "@/server/queries/reps";
import { startOfWeek } from "@/server/reps/service";
import {
  addContactAction,
  draftFollowUpAction,
  optOutAction,
  planWeekAction,
  requestRepContentAction,
  sendFollowUpAction,
} from "./actions";

export const metadata: Metadata = { title: "My AI Team" };

const AGENT_ICON = {
  CONTENT_CREATOR: Bot,
  SOCIAL_MEDIA_MANAGER: CalendarCheck2,
  LEAD_FOLLOWUP: MessagesSquare,
  BUSINESS_COACH: GraduationCap,
} as const;

const AGENT_BLURB = {
  CONTENT_CREATOR: "Creates on-brand, compliant educational content for your audience.",
  SOCIAL_MEDIA_MANAGER: "Plans your posting calendar and schedules approved posts.",
  LEAD_FOLLOWUP: "Follows up with consented contacts and drafts replies for approval.",
  BUSINESS_COACH: "Daily guidance, a weekly plan and accountability to grow your business.",
} as const;

const WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const PRESENTER = {
  PRESENTER: { label: "Presenter", tone: "success" },
  CANDIDATE: { label: "Presenter candidate", tone: "info" },
  NONE: { label: "Rep", tone: "neutral" },
} as const;

export default async function MyTeamPage() {
  const user = await requireUser();
  if (!can(user.role, "rep_pod.full") && !can(user.role, "rep_pod.coach")) redirect("/forbidden");
  const data = await getMyTeam(user.id);
  if (!data.user.onboardedAt) redirect("/onboarding");

  const premium = can(user.role, "rep_pod.full");
  const presenter = PRESENTER[data.user.repProfile?.presenterStatus ?? "NONE"];
  const now = new Date();
  const weekStart = startOfWeek(now);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My AI Team"
        badge={
          <Badge tone="info" className="px-3 py-1 text-sm">
            {premium ? "Premium Rep" : "Free Rep"}
          </Badge>
        }
        description={
          premium
            ? "Your always-on AI agents working together to create content, grow your presence, follow up with consented leads and coach you. The company approves anything that goes out."
            : "Your Business Coach plans your week and keeps you on track. Upgrade to Premium for the full four-agent team."
        }
        actions={
          <Badge tone={presenter.tone} data-testid="presenter-badge" className="px-3 py-1 text-sm">
            <Award className="size-3.5" aria-hidden /> {presenter.label}
          </Badge>
        }
      />

      <section aria-label="Agents" className="grid gap-4 lg:grid-cols-2" data-testid="today">
        {data.agents.map((a) => {
          const Icon = a.role ? AGENT_ICON[a.role] : Bot;
          const status = AGENT_STATUS[a.status];
          const todays = data.today.filter((t) => t.agent?.repRole === a.role);
          const done = todays.filter((t) => t.status === "DONE").length;
          return (
            <Card key={a.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft shadow-glow-soft">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{a.title}</h2>
                    <Badge tone={status.tone}>
                      <StatusDot tone={status.tone} live={a.status === "ACTIVE"} /> {status.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {AGENT_BLURB[a.role ?? "BUSINESS_COACH"]}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 border-t border-border pt-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Today&apos;s Actions</h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done} of {todays.length} complete
                    </span>
                  </div>
                  {todays.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nothing scheduled today.</p>
                  ) : (
                    <ul className="flex flex-col">
                      {todays.map((t) => (
                        <li key={t.id}>
                          <TaskCheck id={t.id} title={t.title} done={t.status === "DONE"} meta="" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <ProgressRing
                  value={todays.length ? done / todays.length : 0}
                  label={`${a.title} today`}
                />
              </div>
              <p className="text-xs text-subtle-foreground">
                {a.openTasks} open · template v{a.templateVersion ?? "?"}
              </p>
            </Card>
          );
        })}
        {!premium && (
          <Card className="flex flex-col justify-center gap-2 p-5">
            <p className="text-lg font-semibold">Want the full team?</p>
            <p className="text-sm text-muted-foreground">
              Premium adds a Content Creator, Social Media Manager and Lead Follow-up Specialist.
              Ask your sponsor or the company to upgrade your plan.
            </p>
            <Link href="/back-office" className="text-sm font-semibold text-cyan hover:underline">
              View my earnings
            </Link>
          </Card>
        )}
      </section>

      <Card
        className="flex flex-col gap-4 p-5 xl:flex-row xl:items-stretch"
        data-testid="weekly-plan"
      >
        <div className="flex shrink-0 items-start gap-3 xl:w-60">
          <span className="flex size-10 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft">
            <CalendarDays className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold">This Week&apos;s Plan</h2>
            <p className="text-xs text-muted-foreground">
              Your AI team&apos;s key focus and targets for the week.
            </p>
            <p
              className="mt-2 text-xs text-muted-foreground tabular-nums"
              data-testid="week-progress"
            >
              {data.progress.done} / {data.progress.total} done
              {data.plan ? ` · Focus: ${data.plan.body.split("\n")[0]}` : ""}
            </p>
          </div>
        </div>
        <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {WEEK.map((day, i) => {
            const date = new Date(weekStart.getTime() + i * 86_400_000);
            const tasks = data.week.filter((t) => t.dueAt && (t.dueAt.getDay() + 6) % 7 === i);
            const complete = tasks.length > 0 && tasks.every((t) => t.status === "DONE");
            const isToday = date.toDateString() === now.toDateString();
            return (
              <li
                key={day}
                aria-label={day}
                className={cn(
                  "flex flex-col gap-2 tile p-2.5",
                  (complete || isToday) && "border-[var(--border-strong)] shadow-glow-soft",
                )}
              >
                <p className="text-sm font-bold">
                  {day.slice(0, 3)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </p>
                {tasks.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Circle className="size-4 shrink-0" aria-hidden /> Rest, reflect &amp; reset
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-start gap-1.5 text-xs leading-snug">
                        {t.status === "DONE" ? (
                          <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />
                        ) : (
                          <Circle
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-label="Open"
                          />
                        )}
                        <span className={t.status === "DONE" ? "text-muted-foreground" : undefined}>
                          {t.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="p-5">
        <ActionForm
          action={planWeekAction}
          submitLabel={
            <>
              <Sparkles aria-hidden /> Plan my week
            </>
          }
          pendingLabel="Your coach is planning…"
          testId="plan-week"
          className="sm:flex-row sm:items-end"
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="goal">Ask your Business Coach to plan the week (optional goal)</Label>
            <Input
              id="goal"
              name="goal"
              maxLength={300}
              placeholder="e.g. Finish the presenter training"
            />
          </div>
        </ActionForm>
      </Card>

      {premium && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Ask your Content Creator for a post</CardTitle>
              <CardDescription>
                It is checked for compliance and approved by the company before you can schedule it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={requestRepContentAction}
                submitLabel="Draft my post"
                pendingLabel="Your Content Creator is writing…"
                testId="rep-content-request"
                resetOnSuccess
              >
                <Label htmlFor="rep-brief">What should the post be about?</Label>
                <textarea
                  id="rep-brief"
                  name="brief"
                  rows={3}
                  required
                  minLength={15}
                  maxLength={1000}
                  className={textareaClass}
                />
                <Label htmlFor="rep-channel">Channel</Label>
                <select
                  id="rep-channel"
                  name="channel"
                  className={selectClass}
                  defaultValue="INSTAGRAM"
                >
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="FACEBOOK">Facebook</option>
                  <option value="TIKTOK">TikTok</option>
                  <option value="YOUTUBE">YouTube</option>
                </select>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>My recent posts</CardTitle>
              <CardDescription>
                Approved posts can be scheduled in the Content Studio.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.myContent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No posts in review yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {data.myContent.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/content/${c.id}`} className="min-w-0 truncate hover:underline">
                        {c.title}
                      </Link>
                      <Badge tone={CONTENT_STATUS[c.status].tone}>
                        {CONTENT_STATUS[c.status].label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {premium && (
        <Card data-testid="leads">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Consented contacts</CardTitle>
            <CardDescription>
              Only people who reached out or opted in. Every contact keeps its consent record. No
              imports, scraping or cold outreach.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {data.contacts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Consent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contacts.map((c) => {
                    const followUps = data.followUps.filter((f) => f.contactId === c.id);
                    const pending = followUps.find((f) => f.status === "PENDING");
                    const ready = followUps.find((f) => f.status === "APPROVED" && !f.dispatchedAt);
                    const optedOut = c.status === "OPTED_OUT";
                    return (
                      <TableRow key={c.id} data-testid={`contact-${c.name}`}>
                        <TableCell>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.email ?? c.phone} · via {CHANNEL[c.preferredChannel]}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-64 text-xs text-muted-foreground">
                          {humanize(c.consentSource)}, {c.consentAt.toLocaleDateString("en-US")}
                          <br />
                          {c.consentEvidence}
                        </TableCell>
                        <TableCell>
                          <Badge
                            tone={optedOut ? "danger" : c.status === "NEW" ? "info" : "neutral"}
                          >
                            {humanize(c.status)}
                          </Badge>
                          {c.lastContactedAt && (
                            <p className="mt-1 text-xs text-subtle-foreground">
                              contacted {formatRelativeTime(c.lastContactedAt)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="min-w-64">
                          {optedOut ? (
                            <span className="text-xs text-muted-foreground">No messages.</span>
                          ) : ready ? (
                            <ActionButton
                              action={sendFollowUpAction.bind(null, ready.id)}
                              variant="primary"
                            >
                              <Send aria-hidden /> Send approved follow-up
                            </ActionButton>
                          ) : pending ? (
                            <Badge tone={APPROVAL_STATUS.PENDING.tone}>Waiting for approval</Badge>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <ActionForm
                                action={draftFollowUpAction}
                                submitLabel="Draft follow-up"
                                pendingLabel="Drafting…"
                                buttonVariant="secondary"
                              >
                                <input type="hidden" name="contactId" value={c.id} />
                                <Input
                                  name="note"
                                  placeholder="Optional note for your agent"
                                  aria-label={`Note for ${c.name}`}
                                  maxLength={300}
                                />
                              </ActionForm>
                              <ActionButton
                                action={optOutAction.bind(null, c.id)}
                                variant="ghost"
                                label={`Mark ${c.name} as opted out`}
                              >
                                Mark opted out
                              </ActionButton>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            <div>
              <h3 className="mb-3 text-sm font-semibold">Add a consented contact</h3>
              <ActionForm
                action={addContactAction}
                submitLabel="Add contact"
                className="grid gap-3 md:grid-cols-2"
                testId="add-contact"
                resetOnSuccess
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="c-name">Name</Label>
                  <Input id="c-name" name="name" required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-email">Email</Label>
                  <Input id="c-email" name="email" type="email" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-phone">Phone</Label>
                  <Input id="c-phone" name="phone" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-channel">Preferred channel</Label>
                  <select
                    id="c-channel"
                    name="preferredChannel"
                    className={selectClass}
                    defaultValue="EMAIL"
                  >
                    <option value="EMAIL">Email</option>
                    <option value="INSTAGRAM">Instagram DM (they messaged you)</option>
                    <option value="FACEBOOK">Facebook DM (they messaged you)</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-source">How did they opt in?</Label>
                  <select
                    id="c-source"
                    name="consentSource"
                    className={selectClass}
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    <option value="WEB_FORM">Web form</option>
                    <option value="INBOUND_MESSAGE">They messaged me first</option>
                    <option value="EVENT_SIGNUP">Event sign-up</option>
                    <option value="REFERRAL_OPT_IN">Referral who opted in</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-when">When</Label>
                  <Input id="c-when" name="consentAt" type="date" required />
                </div>
                <div className="grid gap-1.5 md:col-span-2">
                  <Label htmlFor="c-evidence">What did they do? (consent record)</Label>
                  <Input
                    id="c-evidence"
                    name="consentEvidence"
                    required
                    minLength={5}
                    placeholder="e.g. Asked for the recovery guide on our site"
                  />
                </div>
              </ActionForm>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
