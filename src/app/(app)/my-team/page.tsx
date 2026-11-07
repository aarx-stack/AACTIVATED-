import {
  Award,
  Bot,
  CalendarCheck2,
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
import { Meter } from "@/components/ui/meter";
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
import { formatRelativeTime, humanize } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getMyTeam } from "@/server/queries/reps";
import { WEEKDAYS } from "@/server/agents/skills";
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={premium ? "Premium" : "Free"}
        title="My AI Team"
        description={
          premium
            ? "Your private team drafts, plans and follows up. The company approves anything that goes out."
            : "Your Business Coach plans your week. Upgrade to Premium for the full four-agent team."
        }
        actions={
          <Badge tone={presenter.tone} data-testid="presenter-badge">
            <Award className="size-3" aria-hidden /> {presenter.label}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="today">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Today&apos;s actions</CardTitle>
            <CardDescription>
              {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.today.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing scheduled for today. Ask your coach to plan the week.
              </p>
            ) : (
              <ul className="flex flex-col">
                {data.today.map((t) => (
                  <li key={t.id}>
                    <TaskCheck
                      id={t.id}
                      title={t.title}
                      done={t.status === "DONE"}
                      meta={t.agent?.title ?? "You"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="week-progress">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>This week</CardTitle>
            <CardDescription>
              {data.plan ? data.plan.body.split("\n")[0] : "No plan yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span>Progress</span>
                <span className="tabular-nums">
                  {data.progress.done} / {data.progress.total}
                </span>
              </div>
              <Meter
                value={data.progress.done}
                max={Math.max(1, data.progress.total)}
                label="Weekly progress"
                tone="primary"
              />
            </div>
            <ActionForm
              action={planWeekAction}
              submitLabel={
                <>
                  <Sparkles aria-hidden /> Plan my week
                </>
              }
              pendingLabel="Your coach is planning…"
              testId="plan-week"
            >
              <Label htmlFor="goal">Goal for this week (optional)</Label>
              <Input
                id="goal"
                name="goal"
                maxLength={300}
                placeholder="e.g. Finish onboarding training"
              />
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <section
        aria-label="Agents"
        className={
          premium ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-4 sm:grid-cols-2"
        }
      >
        {data.agents.map((a) => {
          const Icon = a.role ? AGENT_ICON[a.role] : Bot;
          const status = AGENT_STATUS[a.status];
          return (
            <Card key={a.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-10 items-center justify-center rounded-control bg-info-soft text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <Badge tone={status.tone}>
                  <StatusDot tone={status.tone} live={a.status === "ACTIVE"} /> {status.label}
                </Badge>
              </div>
              <div>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {a.openTasks} open · template v{a.templateVersion ?? "?"}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">{a.routine}</p>
            </Card>
          );
        })}
        {!premium && (
          <Card className="flex flex-col justify-center gap-2 p-5">
            <p className="font-medium">Want the full team?</p>
            <p className="text-sm text-muted-foreground">
              Premium adds a Content Creator, Social Media Manager and Lead Follow-up Specialist.
              Ask your sponsor or the company to upgrade your plan.
            </p>
            <Link href="/back-office" className="text-sm font-medium text-primary hover:underline">
              View my earnings
            </Link>
          </Card>
        )}
      </section>

      <Card>
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Weekly plan</CardTitle>
          <CardDescription>From your Business Coach. Tick actions off as you go.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5" data-testid="weekly-plan">
            {WEEKDAYS.map((day, i) => {
              const tasks = data.week.filter((t) => t.dueAt && (t.dueAt.getDay() + 6) % 7 === i);
              return (
                <section
                  key={day}
                  aria-label={day}
                  className="rounded-card border border-border bg-surface-muted p-3"
                >
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {day}
                  </h3>
                  {tasks.length === 0 ? (
                    <p className="text-xs text-subtle-foreground">Rest</p>
                  ) : (
                    <ul className="flex flex-col">
                      {tasks.map((t) => (
                        <li key={t.id}>
                          <TaskCheck
                            id={t.id}
                            title={t.title}
                            done={t.status === "DONE"}
                            meta={t.agent?.title ?? ""}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </CardContent>
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
