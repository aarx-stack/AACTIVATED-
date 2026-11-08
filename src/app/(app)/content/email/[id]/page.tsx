import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SendCampaignButton, SubmitCampaignButton } from "@/components/email/campaign-actions";
import { CampaignEditor } from "@/components/email/campaign-editor";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can, ForbiddenError } from "@/server/authz/permissions";
import { AUDIENCE_LABEL, audiencesFor, getCampaign, renderEmail } from "@/server/email/campaigns";
import { CAMPAIGN_STATUS } from "../status";

export const metadata: Metadata = { title: "Email campaign" };

const SEND_STATUS = {
  SENT: { label: "Sent", tone: "success" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
} as const;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("email.campaigns");
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getCampaign>>;
  try {
    data = await getCampaign(user, id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
  const { campaign: c, sends } = data;
  const status = CAMPAIGN_STATUS[c.status];
  const editable = c.status === "DRAFT" || c.status === "REJECTED";
  const audiences = audiencesFor(user.role).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }));
  const preview = renderEmail(c.body, "(unsubscribe link)").text;

  return (
    <>
      <Link
        href="/content/email"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Email campaigns
      </Link>
      <PageHeader
        title={c.name}
        description={`To ${AUDIENCE_LABEL[c.audience].toLowerCase()} · written by ${c.createdBy.name ?? "a team member"} · updated ${formatRelativeTime(c.updatedAt)}`}
        actions={
          <Badge tone={status.tone} data-testid="campaign-status">
            {status.label}
          </Badge>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          {editable && audiences.some((a) => a.value === c.audience) ? (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>{c.status === "REJECTED" ? "Revise and resubmit" : "Edit"}</CardTitle>
              </CardHeader>
              <CardContent>
                <CampaignEditor
                  audiences={audiences}
                  initial={{
                    id: c.id,
                    name: c.name,
                    audience: c.audience,
                    subject: c.subject,
                    body: c.body,
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Preview</CardTitle>
              <CardDescription>Exactly what each person receives.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="tile p-4 text-sm" data-testid="email-preview">
                <p className="text-xs text-muted-foreground">Subject</p>
                <p className="font-semibold">{c.subject}</p>
                <p className="mt-3 break-words whitespace-pre-wrap">{preview}</p>
              </div>
            </CardContent>
          </Card>

          {sends.length > 0 && (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>Recipients</CardTitle>
                <CardDescription>
                  {c.sentCount} sent · {c.skippedCount} skipped
                  {c.failedCount ? ` · ${c.failedCount} failed` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul
                  className="flex flex-col divide-y divide-border text-sm"
                  data-testid="recipients"
                >
                  {sends.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{s.name ?? "Unnamed contact"}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.email
                            ? `${s.email}${s.reason ? ` · ${s.reason}` : ""}`
                            : (s.reason ?? "No email address")}
                        </span>
                      </span>
                      <Badge tone={SEND_STATUS[s.status].tone}>{SEND_STATUS[s.status].label}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="min-w-0 self-start">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Next step</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {c.status === "DRAFT" && (
              <>
                <p className="text-muted-foreground">
                  Sending for approval runs the compliance check and puts it in the Approval Queue.
                  Someone other than you decides; more than 250 recipients or a high-risk finding
                  needs an executive.
                </p>
                <SubmitCampaignButton id={c.id} />
              </>
            )}
            {c.status === "IN_REVIEW" && (
              <p className="text-muted-foreground">
                Waiting for a decision. About {c.recipientEstimate ?? "?"} people will receive it.
              </p>
            )}
            {c.status === "REJECTED" && (
              <p className="text-muted-foreground">
                Rejected. Edit it and save to send it for approval again.
              </p>
            )}
            {c.status === "APPROVED" && (
              <>
                <p className="text-muted-foreground">
                  Approved. Sending goes through GoHighLevel and skips anyone who unsubscribed or is
                  marked do-not-disturb.
                </p>
                <SendCampaignButton id={c.id} estimate={c.recipientEstimate} />
              </>
            )}
            {c.status === "SENDING" && <p className="text-muted-foreground">Sending now.</p>}
            {c.status === "SENT" && c.sentAt && (
              <p className="text-muted-foreground">Sent {formatRelativeTime(c.sentAt)}.</p>
            )}
            {c.lastError && (
              <p role="alert" className="text-danger">
                {c.lastError}
              </p>
            )}
            {c.approvalRequestId && can(user.role, "approvals.view") && (
              <Link
                href={`/approvals/${c.approvalRequestId}`}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                Approval request <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
