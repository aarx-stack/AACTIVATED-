import { ArrowLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { AUDIENCE_LABEL, listCampaigns } from "@/server/email/campaigns";
import { CAMPAIGN_STATUS } from "./status";

export const metadata: Metadata = { title: "Email campaigns" };

export default async function EmailCampaignsPage() {
  const user = await requirePagePermission("email.campaigns");
  const campaigns = await listCampaigns(user);
  const isRep = user.role === "PREMIUM_REP";

  return (
    <>
      <Link
        href="/content"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Content Studio
      </Link>
      <PageHeader
        title="Email campaigns"
        description={
          isRep
            ? "Email your own contacts who agreed to hear from you. Every email is checked and approved by the company before it is sent through your GoHighLevel account."
            : "Email clinics, members and reps through GoHighLevel. Every campaign is checked for compliance and approved by someone other than its author; large or high-risk sends need an executive."
        }
        actions={
          <Button asChild>
            <Link href="/content/email/new">
              <Plus aria-hidden /> New campaign
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>
            Only contacts who agreed to receive email are included. Anyone who unsubscribed or is
            marked do-not-disturb in GoHighLevel is skipped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No campaigns yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="campaign-list">
              {campaigns.map((c) => {
                const status = CAMPAIGN_STATUS[c.status];
                return (
                  <li key={c.id}>
                    <Link
                      href={`/content/email/${c.id}`}
                      className="flex flex-wrap items-center gap-3 tile p-4 hover:bg-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{c.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{c.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {AUDIENCE_LABEL[c.audience]} · by {c.createdBy.name ?? "a team member"} ·{" "}
                          {formatRelativeTime(c.updatedAt)}
                        </p>
                      </div>
                      {c.status === "SENT" && (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {c.sentCount} sent · {c.skippedCount} skipped
                        </span>
                      )}
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
