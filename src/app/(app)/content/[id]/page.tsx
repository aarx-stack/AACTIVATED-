import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HighlightedText } from "@/components/approvals/highlighted-text";
import { CaptionEditor } from "@/components/content/caption-editor";
import { ScheduleForm } from "@/components/content/schedule-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APPROVAL_STATUS, CHANNEL, CONTENT_STATUS, OUTCOME, RISK } from "@/lib/labels";
import { formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { groupViolations } from "@/server/compliance/engine";
import { readViolations } from "@/server/compliance/service";
import { splitBody } from "@/server/content/studio";
import { getContentDetail } from "@/server/queries/content";

export const metadata: Metadata = { title: "Post" };

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("content_studio.view");
  const { id } = await params;
  const item = await getContentDetail(user, id);
  if (!item) notFound();

  const approval = item.approvalRequests[0];
  const check = approval?.complianceChecks[0];
  const violations = check ? readViolations(check.violations) : [];
  const { caption, hashtags } = splitBody(item.body);
  const editable =
    (item.status === "DRAFT" || item.status === "REJECTED") && can(user.role, "content.create");
  const status = CONTENT_STATUS[item.status];

  return (
    <>
      <Link
        href="/content"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Content Studio
      </Link>
      <PageHeader
        eyebrow={`${CHANNEL[item.channel]} post`}
        title={item.title}
        description={
          item.authorAgent
            ? `Drafted by ${item.authorAgent.title}${item.rep ? ` for ${item.rep.name}` : ""}.`
            : item.rep
              ? `Written by ${item.rep.name}.`
              : "Company post."
        }
        actions={
          <Badge tone={status.tone} data-testid="post-status">
            {status.label}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {editable ? (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>
                  {item.status === "REJECTED" ? "Revise and resubmit" : "Edit draft"}
                </CardTitle>
                {item.status === "REJECTED" && approval?.decisionNote && (
                  <CardDescription>Reviewer note: {approval.decisionNote}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <CaptionEditor
                  draft={{
                    id: item.id,
                    title: item.title,
                    caption,
                    hashtags,
                    channel: item.channel,
                    plannedFor: item.scheduledFor
                      ? item.scheduledFor.toISOString().slice(0, 10)
                      : "",
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>Post</CardTitle>
                <CardDescription>
                  {item.status === "IN_REVIEW"
                    ? "Locked while it is in review. Reviewers can edit it in the Approval Queue."
                    : "The approved version. It cannot be changed without a new approval."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="rounded-control border border-border bg-surface-muted p-4"
                  data-testid="post-preview"
                >
                  <HighlightedText text={item.title} flags={violations} className="font-medium" />
                  <HighlightedText text={caption} flags={violations} className="mt-2 text-sm" />
                  {hashtags.length > 0 && (
                    <p className="mt-3 text-sm text-primary">{hashtags.join(" ")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {item.status === "APPROVED" && can(user.role, "content.schedule") && (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>Schedule</CardTitle>
                <CardDescription>Approved and ready to schedule.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScheduleForm id={item.id} />
              </CardContent>
            </Card>
          )}

          {item.status === "SCHEDULED" && item.scheduledFor && (
            <Card>
              <CardContent className="p-5 text-sm">
                Scheduled for{" "}
                <strong>
                  {item.scheduledFor.toLocaleString("en-US", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </strong>
                {item.scheduledBy && ` by ${item.scheduledBy.name}`}. GoHighLevel reference{" "}
                <span className="font-mono">{item.externalPostId}</span>.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card data-testid="post-compliance">
            <CardHeader>
              <div className="flex items-center gap-2">
                {check?.outcome === "PASS" ? (
                  <ShieldCheck className="size-5 text-success" aria-hidden />
                ) : (
                  <ShieldAlert className="size-5 text-warning" aria-hidden />
                )}
                <CardTitle>Compliance and approval</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {!approval ? (
                <p className="text-muted-foreground">Not sent for review yet.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={APPROVAL_STATUS[approval.status].tone}>
                      {APPROVAL_STATUS[approval.status].label}
                    </Badge>
                    {check && (
                      <Badge tone={OUTCOME[check.outcome].tone}>
                        {OUTCOME[check.outcome].label}
                      </Badge>
                    )}
                    <Badge tone={RISK[approval.risk].tone}>{RISK[approval.risk].label}</Badge>
                  </div>
                  {groupViolations(violations).map((v, i) => (
                    <p key={i} className="text-muted-foreground">
                      &ldquo;{v.match}&rdquo;{v.count > 1 ? ` ×${v.count}` : ""}: {v.message}
                      {v.suggestion ? ` ${v.suggestion}` : ""}
                    </p>
                  ))}
                  {approval.decidedBy && (
                    <p className="text-muted-foreground">
                      Decided by {approval.decidedBy.name}
                      {approval.decidedAt && ` ${formatRelativeTime(approval.decidedAt)}`}.
                    </p>
                  )}
                  {can(user.role, "approvals.view") && (
                    <Link
                      href={`/approvals/${approval.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Open in Approval Queue
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
