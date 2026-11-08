import { ArrowLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { KIND_LABEL, listPublications, partWord } from "@/server/publishing/service";
import { PUBLICATION_STATUS } from "./status";

export const metadata: Metadata = { title: "Publishing" };

export default async function PublishingPage() {
  const user = await requirePagePermission("publishing.manage");
  const items = await listPublications(user);
  return (
    <>
      <Link
        href="/content"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Content Studio
      </Link>
      <PageHeader
        title="Publishing"
        description="Articles, books and e-books, written part by part with the Publishing team's AI agents. Everything is an internal draft until an executive approves it for publishing."
        actions={
          <Button asChild>
            <Link href="/content/publishing/new">
              <Plus aria-hidden /> New publication
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Publications</CardTitle>
          <CardDescription>
            Export any of them as a PDF or an EPUB e-book. Copies are marked DRAFT until the exact
            text is approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="publication-list">
              {items.map((p) => {
                const status = PUBLICATION_STATUS[p.status];
                const word = partWord(p.kind);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/content/publishing/${p.id}`}
                      className="flex flex-wrap items-center gap-3 tile p-4 hover:bg-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{p.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {KIND_LABEL[p.kind]} for {p.audience} · {p.written} of {p.sectionCount}{" "}
                          {word}
                          {p.sectionCount === 1 ? "" : "s"} written ·{" "}
                          {p.words.toLocaleString("en-US")} words · updated{" "}
                          {formatRelativeTime(p.updatedAt)}
                        </p>
                      </div>
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
