import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CampaignEditor } from "@/components/email/campaign-editor";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { AUDIENCE_LABEL, audiencesFor } from "@/server/email/campaigns";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const user = await requirePagePermission("email.campaigns");
  const audiences = audiencesFor(user.role).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }));
  return (
    <div className="max-w-3xl">
      <Link
        href="/content/email"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Email campaigns
      </Link>
      <PageHeader
        title="New campaign"
        description="Write the email, or have an agent draft it. Save it, then send it for approval."
      />
      <Card>
        <CardContent className="p-6">
          <CampaignEditor
            audiences={audiences}
            initial={{ name: "", audience: audiences[0]?.value ?? "", subject: "", body: "" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
