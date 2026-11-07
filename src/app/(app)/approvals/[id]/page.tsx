import { ArrowLeft, BookOpen, Bot, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { HighlightedText } from "@/components/approvals/highlighted-text";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPROVAL_STATUS,
  APPROVAL_TYPE,
  CHANNEL,
  CONTENT_STATUS,
  OUTCOME,
  RISK,
  auditLabel,
} from "@/lib/labels";
import { formatRelativeTime, formatUsd } from "@/lib/utils";
import { isSocialPostPayload, readSources } from "@/server/approvals/payload";
import { canDecideApproval } from "@/server/approvals/policy";
import { requirePagePermission } from "@/server/auth/session";
import { ROLE_LABELS } from "@/server/authz/permissions";
import { groupViolations } from "@/server/compliance/engine";
import { readViolations } from "@/server/compliance/service";
import { getApprovalDetail } from "@/server/queries/approvals";

export const metadata: Metadata = { title: "Review request" };

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("approvals.view");
  const { id } = await params;
  const detail = await getApprovalDetail(user.role, id);
  if (!detail) notFound();
  const { request, trail } = detail;

  const latestCheck = request.complianceChecks[0];
  const violations = latestCheck ? readViolations(latestCheck.violations) : [];
  const sources = readSources(request.sources);
  const post = isSocialPostPayload(request.payload) ? request.payload : null;
  const decision = canDecideApproval(user, request);
  const canEdit =
    post !== null && canDecideApproval(user, { ...request, requiredRole: "STAFF" }).ok;
  const status = APPROVAL_STATUS[request.status];

  return (
    <>
      <Link
        href="/approvals"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Approval Queue
      </Link>
      <PageHeader
        eyebrow={APPROVAL_TYPE[request.type]}
        title={request.title}
        description={request.summary}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={status.tone} data-testid="approval-status">
              {status.label}
            </Badge>
            <Badge tone={RISK[request.risk].tone}>{RISK[request.risk].label}</Badge>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* What would leave the building */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>
                  {post
                    ? `${CHANNEL[post.channel as keyof typeof CHANNEL] ?? post.channel} post`
                    : "Request"}
                </CardTitle>
                <CardDescription className="mt-1">
                  Exactly what is sent if approved. Revision {request.revision}.
                </CardDescription>
              </div>
              {request.contentItem && (
                <Badge
                  tone={CONTENT_STATUS[request.contentItem.status].tone}
                  data-testid="content-status"
                >
                  {CONTENT_STATUS[request.contentItem.status].label}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {post ? (
                <div
                  className="rounded-control border border-border bg-surface-muted p-4"
                  data-testid="content-preview"
                >
                  <HighlightedText text={post.title} flags={violations} className="font-medium" />
                  <HighlightedText
                    text={post.caption}
                    flags={violations}
                    className="mt-2 text-sm"
                  />
                  {post.hashtags.length > 0 && (
                    <p className="mt-3 text-sm text-primary">{post.hashtags.join(" ")}</p>
                  )}
                </div>
              ) : (
                <dl className="grid gap-2 text-sm">
                  {request.amountUsd && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Amount</dt>
                      <dd className="font-medium tabular-nums">
                        {formatUsd(request.amountUsd.toNumber())}
                      </dd>
                    </div>
                  )}
                  {request.budget && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Budget</dt>
                      <dd>{request.budget.name}</dd>
                    </div>
                  )}
                  <pre className="overflow-x-auto rounded-control bg-surface-muted p-3 text-xs">
                    {JSON.stringify(request.payload, null, 2)}
                  </pre>
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Compliance */}
          <Card data-testid="compliance-result">
            <CardHeader>
              <div className="flex items-center gap-2">
                {latestCheck?.outcome === "PASS" ? (
                  <ShieldCheck className="size-5 text-success" aria-hidden />
                ) : (
                  <ShieldAlert className="size-5 text-warning" aria-hidden />
                )}
                <CardTitle>Compliance check</CardTitle>
              </div>
              {latestCheck && (
                <Badge tone={OUTCOME[latestCheck.outcome].tone}>
                  {OUTCOME[latestCheck.outcome].label}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {!latestCheck ? (
                <p className="text-sm text-muted-foreground">
                  No automated check applies to this request type.
                </p>
              ) : violations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No findings against the current content rules. Checked{" "}
                  {formatRelativeTime(latestCheck.checkedAt)}.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {groupViolations(violations).map((v, i) => (
                    <li key={i} className="rounded-control border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={RISK[v.severity].tone}>{v.severity.toLowerCase()}</Badge>
                        <span className="font-medium">&ldquo;{v.match}&rdquo;</span>
                        {v.count > 1 && (
                          <span className="text-xs text-muted-foreground">×{v.count}</span>
                        )}
                        <span className="text-muted-foreground">· {v.message}</span>
                      </div>
                      {v.suggestion && (
                        <p className="mt-1 text-muted-foreground">Suggestion: {v.suggestion}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Reasoning + sources: always above the decision */}
          <Card data-testid="agent-reasoning">
            <CardHeader className="flex-col items-stretch">
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-primary" aria-hidden /> Agent reasoning
              </CardTitle>
              {request.requestedByAgent && (
                <CardDescription>
                  {request.requestedByAgent.name}, {request.requestedByAgent.title} · human owner{" "}
                  {request.requestedByAgent.owner.name}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm whitespace-pre-line">{request.reasoning}</p>
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  <BookOpen className="size-3.5" aria-hidden /> Sources
                </p>
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="sources">
                  {sources.map((s, i) => (
                    <li key={i}>
                      <span className="font-medium">{s.title}</span>
                      {s.note && <span className="text-muted-foreground"> · {s.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Decision */}
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Decision</CardTitle>
              <CardDescription>
                {request.requiredRole === "EXECUTIVE"
                  ? "Needs an executive: restricted type or high risk."
                  : "Staff or executives may decide."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {request.status === "PENDING" ? (
                <DecisionPanel
                  key={request.revision}
                  id={request.id}
                  canDecide={decision.ok}
                  decideBlockedReason={decision.ok ? undefined : decision.reason}
                  canEdit={canEdit}
                  complianceFailed={latestCheck?.outcome === "FAIL"}
                  draft={
                    post
                      ? { title: post.title, caption: post.caption, hashtags: post.hashtags }
                      : undefined
                  }
                />
              ) : (
                <div className="text-sm">
                  <p>
                    <span className="font-medium">{status.label}</span> by{" "}
                    {request.decidedBy?.name ?? "unknown"}
                    {request.decidedAt && ` ${formatRelativeTime(request.decidedAt)}`}.
                  </p>
                  {request.decisionNote && (
                    <p className="mt-1 text-muted-foreground">Note: {request.decisionNote}</p>
                  )}
                  {request.status === "APPROVED" && request.contentItem && (
                    <p className="mt-2 text-success">
                      Ready to schedule. Scheduling arrives with the Content Studio (Phase 3).
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{APPROVAL_TYPE[request.type]}</dd>
                <dt className="text-muted-foreground">Who decides</dt>
                <dd>{ROLE_LABELS[request.requiredRole]} or above</dd>
                <dt className="text-muted-foreground">Requested</dt>
                <dd>{formatRelativeTime(request.createdAt)}</dd>
                <dt className="text-muted-foreground">Revision</dt>
                <dd className="tabular-nums">{request.revision}</dd>
                {request.editedBy && (
                  <>
                    <dt className="text-muted-foreground">Last edit</dt>
                    <dd>{request.editedBy.name}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Fingerprint</dt>
                <dd className="truncate font-mono text-xs" title={request.payloadHash}>
                  {request.payloadHash.slice(0, 12)}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Audit trail</CardTitle>
              <CardDescription>Every step, in order. Append-only.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol
                className="relative flex flex-col gap-4 border-l border-border pl-5"
                data-testid="audit-trail"
              >
                {trail.map((t) => (
                  <li key={t.id} className="relative">
                    <span
                      aria-hidden
                      className={
                        "absolute top-1.5 -left-[25px] size-2.5 rounded-pill border-2 border-background " +
                        (t.actorType === "USER"
                          ? "bg-primary"
                          : t.actorType === "AGENT"
                            ? "bg-chart-3"
                            : "bg-subtle-foreground")
                      }
                    />
                    <p className="text-sm font-medium">{auditLabel(t.action)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.actor} ·{" "}
                      <time dateTime={t.createdAt.toISOString()}>
                        {formatRelativeTime(t.createdAt)}
                      </time>
                    </p>
                  </li>
                ))}
                {trail.length === 0 && (
                  <li className="text-sm text-muted-foreground">No entries yet.</li>
                )}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
