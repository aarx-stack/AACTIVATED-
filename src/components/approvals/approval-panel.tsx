import { CircleCheck, ExternalLink, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { RecordPurchaseButton } from "@/components/finance/budget-forms";
import { HighlightedText } from "@/components/approvals/highlighted-text";
import { ApprovalTypeIcon } from "@/components/approvals/type-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Role } from "@/generated/prisma/enums";
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
import { readBudgetChange } from "@/server/budgets/change-requests";
import { canDecideApproval, canEditApproval } from "@/server/approvals/policy";
import { can } from "@/server/authz/permissions";
import { isContinuePayload } from "@/server/budgets/service";
import { ROLE_LABELS } from "@/server/authz/permissions";
import { groupViolations } from "@/server/compliance/engine";
import { readViolations } from "@/server/compliance/service";
import type { ApprovalDetail } from "@/server/queries/approvals";

export const COMPLIANCE_PILL = {
  PASS: { label: "Compliant", tone: "success" },
  WARN: { label: "Warnings", tone: "warning" },
  FAIL: { label: "Non-compliant", tone: "danger" },
} as const;

/** Splits reasoning into readable bullet points. */
function bullets(text: string) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function MessagePreview({ payload }: { payload: unknown }) {
  const p = payload as { to?: string; subject?: string; message?: string; channel?: string };
  if (typeof p?.message !== "string") return null;
  return (
    <div className="tile p-4 text-sm" data-testid="content-preview">
      <p className="text-xs text-muted-foreground">
        To {p.to} via {CHANNEL[(p.channel ?? "EMAIL") as keyof typeof CHANNEL] ?? p.channel}
      </p>
      {p.subject && <p className="mt-1 font-semibold">{p.subject}</p>}
      <p className="mt-2 whitespace-pre-line">{p.message}</p>
    </div>
  );
}

export function ApprovalPanel({
  detail,
  viewer,
}: {
  detail: ApprovalDetail;
  viewer: { id: string; role: Role; status?: "INVITED" | "ACTIVE" | "SUSPENDED" };
}) {
  const { request, trail } = detail;
  const latestCheck = request.complianceChecks[0];
  const violations = latestCheck ? readViolations(latestCheck.violations) : [];
  const grouped = groupViolations(violations);
  const sources = readSources(request.sources);
  const post = isSocialPostPayload(request.payload) ? request.payload : null;
  const decision = canDecideApproval(viewer, request);
  const canEdit = post !== null && canEditApproval(viewer, request).ok;
  const status = APPROVAL_STATUS[request.status];
  const owner = request.requestedByAgent
    ? `${request.requestedByAgent.title} (${request.requestedByAgent.name})`
    : (request.requestedByUser?.name ?? "A team member");

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <ApprovalTypeIcon type={request.type} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-snug font-semibold">{request.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Type:{" "}
              <span className="font-semibold text-foreground">{APPROVAL_TYPE[request.type]}</span> ·
              Owner: <span className="font-semibold text-foreground">{owner}</span> · Requested{" "}
              {formatRelativeTime(request.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={status.tone} data-testid="approval-status">
            {status.label}
          </Badge>
          {latestCheck && (
            <Badge tone={COMPLIANCE_PILL[latestCheck.outcome].tone}>
              {COMPLIANCE_PILL[latestCheck.outcome].label}
            </Badge>
          )}
          <Badge tone={RISK[request.risk].tone}>{RISK[request.risk].label}</Badge>
          {request.revision > 1 && <Badge tone="outline">Revision {request.revision}</Badge>}
          {request.contentItem && (
            <Badge
              tone={CONTENT_STATUS[request.contentItem.status].tone}
              data-testid="content-status"
            >
              {CONTENT_STATUS[request.contentItem.status].label}
            </Badge>
          )}
        </div>

        {/* Exactly what leaves the building */}
        {post ? (
          <div className="tile p-4" data-testid="content-preview">
            <p className="mb-1 text-xs text-muted-foreground">
              {CHANNEL[post.channel as keyof typeof CHANNEL] ?? post.channel} post · exactly what is
              sent if approved
            </p>
            <HighlightedText text={post.title} flags={violations} className="font-semibold" />
            <HighlightedText text={post.caption} flags={violations} className="mt-2 text-sm" />
            {post.hashtags.length > 0 && (
              <p className="mt-2 text-sm text-cyan">{post.hashtags.join(" ")}</p>
            )}
          </div>
        ) : (
          <>
            <MessagePreview payload={request.payload} />
            {request.type === "BUDGET_CHANGE" && readBudgetChange(request.payload) && (
              <div className="tile p-4" data-testid="budget-change">
                <p className="mb-1 text-xs text-muted-foreground">
                  Budget limit change{request.budget ? ` · ${request.budget.name}` : ""}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatUsd(readBudgetChange(request.payload)!.fromLimitUsd)}
                  <span className="mx-2 text-sm font-normal text-muted-foreground">to</span>
                  {formatUsd(readBudgetChange(request.payload)!.toLimitUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approving sets the new limit straight away, if the limit has not changed since the
                  request.
                </p>
              </div>
            )}
            {request.amountUsd && (
              <p className="text-sm">
                Amount{" "}
                <span className="font-semibold tabular-nums">
                  {formatUsd(request.amountUsd.toNumber())}
                </span>
                {request.budget && (
                  <span className="text-muted-foreground"> · {request.budget.name}</span>
                )}
              </p>
            )}
          </>
        )}

        {/* Compliance */}
        <section className="tile p-4" data-testid="compliance-result" aria-label="Compliance check">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {latestCheck?.outcome === "PASS" ? (
                <ShieldCheck className="size-4 text-success" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 text-warning" aria-hidden />
              )}
              Compliance Check
            </h3>
            {latestCheck && (
              <Badge tone={OUTCOME[latestCheck.outcome].tone}>
                {OUTCOME[latestCheck.outcome].label}
              </Badge>
            )}
          </div>
          {!latestCheck ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No automated check applies to this request type.
            </p>
          ) : grouped.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No findings against the current content rules.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {grouped.map((v, i) => (
                <li key={i}>
                  <Badge tone={RISK[v.severity].tone} className="mr-2">
                    {v.severity.toLowerCase()}
                  </Badge>
                  <span className="font-semibold">&ldquo;{v.match}&rdquo;</span>
                  {v.count > 1 && (
                    <span className="text-xs text-muted-foreground"> ×{v.count}</span>
                  )}
                  <span className="text-muted-foreground"> · {v.message}</span>
                  {v.suggestion && (
                    <span className="block pl-1 text-xs text-muted-foreground">
                      Suggestion: {v.suggestion}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Reasoning + sources: always above the decision */}
        <section className="tile p-4" data-testid="agent-reasoning" aria-label="Agent reasoning">
          <h3 className="text-sm font-semibold">
            {request.requestedByAgentId ? "Agent Reasoning" : "Reasoning"}
          </h3>
          <ul className="mt-2 flex list-none flex-col gap-1.5 text-sm">
            {bullets(request.reasoning).map((b, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-pill bg-[var(--accent-cyan)]"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {request.requestedByAgent && (
            <p className="mt-2 text-xs text-muted-foreground">
              Human owner of this agent: {request.requestedByAgent.owner.name}
            </p>
          )}
        </section>

        <section aria-label="Sources">
          <h3 className="mb-2 text-sm font-semibold">Sources ({sources.length})</h3>
          <ul className="flex flex-col gap-1.5" data-testid="sources">
            {sources.map((s, i) => (
              <li key={i} className="flex items-center gap-2 tile px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-cyan" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.title}</span>
                  {s.note && <span className="text-muted-foreground"> · {s.note}</span>}
                </span>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-semibold text-cyan"
                  >
                    View <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Decision */}
        <section aria-label="Decision" className="border-t border-border pt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Decided by {ROLE_LABELS[request.requiredRole]}
            {request.requiredRole === "STAFF" ? " or Executive" : ""}
            {request.requiredRole === "EXECUTIVE" ? ": restricted type or high risk" : ""}.
          </p>
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
              <p className="flex items-center gap-2">
                <CircleCheck className="size-4 text-cyan" aria-hidden />
                <span>
                  <span className="font-semibold">{status.label}</span> by{" "}
                  {request.decidedBy?.name ?? "unknown"}
                  {request.decidedAt && ` ${formatRelativeTime(request.decidedAt)}`}.
                </span>
              </p>
              {request.decisionNote && (
                <p className="mt-1 text-muted-foreground">Note: {request.decisionNote}</p>
              )}
              {request.status === "APPROVED" && request.contentItem && (
                <p className="mt-2 text-success">
                  Ready to schedule.{" "}
                  <Link
                    href={`/content/${request.contentItem.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    Open in Content Studio
                  </Link>
                </p>
              )}
              {request.status === "APPROVED" &&
                request.type === "SPEND" &&
                request.budget &&
                (isContinuePayload(request.payload) ? (
                  <p className="mt-2 text-success">
                    Spending in {request.budget.name} can continue by up to{" "}
                    {formatUsd(Number(request.amountUsd ?? 0))}.{" "}
                    <Link
                      href="/finance"
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      Open Finance & Budget
                    </Link>
                  </p>
                ) : (
                  !request.dispatchedAt &&
                  can(viewer.role, "budget.manage") && (
                    <div className="mt-3">
                      <RecordPurchaseButton
                        approvalId={request.id}
                        label={`Record purchase (${formatUsd(Number(request.amountUsd ?? 0))})`}
                      />
                    </div>
                  )
                ))}
              {request.status === "APPROVED" && request.type === "BUDGET_CHANGE" && (
                <p className="mt-2 text-success">
                  The new limit is in effect.{" "}
                  <Link
                    href="/budgets"
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    Open Budgets
                  </Link>
                </p>
              )}
              {request.dispatchedAt && (
                <p className="mt-1 text-muted-foreground">
                  {request.type === "SPEND" ? "Recorded" : "Sent"}{" "}
                  {formatRelativeTime(request.dispatchedAt)}.
                </p>
              )}
            </div>
          )}
        </section>
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold">Audit Log</h3>
        <p className="text-xs text-muted-foreground">Every step, in order. Append-only.</p>
        <ol className="relative mt-4 flex flex-col gap-3 pl-5" data-testid="audit-trail">
          <span
            aria-hidden
            className="absolute top-1 bottom-1 left-[5px] w-px bg-[var(--border-strong)]"
          />
          {trail.map((t) => (
            <li key={t.id} className="relative grid grid-cols-[88px_1fr] gap-3 text-sm">
              <span
                aria-hidden
                className="absolute top-1.5 -left-5 size-2.5 rounded-pill bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan)]"
              />
              <time
                className="text-xs text-muted-foreground tabular-nums"
                dateTime={t.createdAt.toISOString()}
              >
                {t.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </time>
              <span>
                <span className="font-medium">{auditLabel(t.action)}</span>
                <span className="block text-xs text-muted-foreground">{t.actor}</span>
              </span>
            </li>
          ))}
          {trail.length === 0 && <li className="text-sm text-muted-foreground">No entries yet.</li>}
        </ol>
      </Card>
    </div>
  );
}
