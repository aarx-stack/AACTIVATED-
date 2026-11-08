import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewDocumentForm } from "@/components/knowledge/knowledge-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Add document" };

export default async function NewDocumentPage() {
  const user = await requirePagePermission("knowledge.manage");
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link
        href="/knowledge"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Knowledge Library
      </Link>
      <PageHeader
        title="Add document"
        description="The Brain writes an AI summary when you add it. Choose carefully who can read it."
      />
      <Card className="p-6">
        <NewDocumentForm isExecutive={user.role === Role.EXECUTIVE} />
      </Card>
    </div>
  );
}
