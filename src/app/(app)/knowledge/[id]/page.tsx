import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentBody } from "@/components/knowledge/document-body";
import { SummarizeButton } from "@/components/knowledge/knowledge-forms";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { ACCESS_LABEL, CATEGORY_LABEL, getDocument, wordCount } from "@/server/knowledge/service";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("knowledge.view");
  const { id } = await params;
  // Same response for "missing" and "not allowed": existence is not revealed.
  const doc = await getDocument(user, id);
  if (!doc) notFound();
  const manage = can(user.role, "knowledge.manage");

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/knowledge?doc=${doc.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Knowledge Library
      </Link>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-6 md:p-8">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone="info">{CATEGORY_LABEL[doc.category]}</Badge>
            <Badge tone={doc.accessLevel === "EXECUTIVE_ONLY" ? "neutral" : "success"}>
              {ACCESS_LABEL[doc.accessLevel]}
            </Badge>
          </div>
          <h1 className="text-[28px] leading-tight font-bold text-balance">{doc.title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            {doc.owner?.name ? `Owner: ${doc.owner.name} · ` : ""}
            {Math.max(1, Math.round(wordCount(doc.body) / 200))} min read · Updated{" "}
            {doc.updatedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <DocumentBody text={doc.body} />
          {doc.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {doc.tags.map((t) => (
                <Badge key={t} tone="outline">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h2 className="text-lg font-bold">AI Summary</h2>
          {doc.summary ? (
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p className="leading-relaxed text-muted-foreground">{doc.summary}</p>
              {doc.keyPoints.length > 0 && (
                <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-cyan">
                  {doc.keyPoints.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No AI summary yet.</p>
          )}
          {manage && (
            <div className="mt-4">
              <SummarizeButton
                documentId={doc.id}
                label={doc.summary ? "Refresh summary" : "Generate summary"}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
