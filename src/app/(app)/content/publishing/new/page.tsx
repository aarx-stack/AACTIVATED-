import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewPublicationForm } from "@/components/publishing/publishing-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "New publication" };

export default async function NewPublicationPage() {
  await requirePagePermission("publishing.manage");
  return (
    <div className="max-w-3xl">
      <Link
        href="/content/publishing"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Publishing
      </Link>
      <PageHeader
        title="New publication"
        description="Describe it and the Publishing team outlines the chapters (or sections) for you to edit. Then write each part yourself or with AI."
      />
      <Card>
        <CardContent className="p-6">
          <NewPublicationForm />
        </CardContent>
      </Card>
    </div>
  );
}
