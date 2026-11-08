import { ArrowLeft, ArrowRight, BookDown, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AddSectionForm,
  MoveButtons,
  SectionEditor,
  SubmitPublicationButton,
} from "@/components/publishing/publishing-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can, ForbiddenError } from "@/server/authz/permissions";
import { getPublication, KIND_LABEL, partWord, wordCount } from "@/server/publishing/service";
import { PUBLICATION_STATUS } from "../status";

export const metadata: Metadata = { title: "Publication" };

export default async function PublicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ part?: string }>;
}) {
  const user = await requirePagePermission("publishing.manage");
  const { id } = await params;
  const { part } = await searchParams;
  let data: Awaited<ReturnType<typeof getPublication>>;
  try {
    data = await getPublication(user, id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
  const { publication: p, words, approvedAndUnchanged, changedSinceApproval } = data;
  const status = PUBLICATION_STATUS[p.status];
  const word = partWord(p.kind);
  const selected = p.sections.find((s) => s.id === part) ?? p.sections[0];
  const locked = p.status === "IN_REVIEW";

  return (
    <>
      <Link
        href="/content/publishing"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Publishing
      </Link>
      <PageHeader
        title={p.title}
        description={`${KIND_LABEL[p.kind]} for ${p.audience}${p.subtitle ? ` · ${p.subtitle}` : ""} · ${words.toLocaleString("en-US")} words · started by ${p.author.name ?? "a team member"}`}
        actions={
          <>
            <Badge tone={status.tone} data-testid="publication-status">
              {status.label}
            </Badge>
            <Button asChild variant="secondary" size="sm">
              <a href={`/print/publishing/${p.id}`} target="_blank" rel="noreferrer">
                <Printer aria-hidden /> PDF
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/publishing/${p.id}/epub`} download>
                <BookDown aria-hidden /> EPUB
              </a>
            </Button>
          </>
        }
      />

      {(locked || changedSinceApproval || p.status === "REJECTED" || approvedAndUnchanged) && (
        <p
          role="status"
          className={cn(
            "mb-4 rounded-card border px-4 py-3 text-sm",
            approvedAndUnchanged
              ? "border-success-line bg-success-soft text-success"
              : "border-warning-line bg-warning-soft text-warning",
          )}
        >
          {locked
            ? "Waiting for an executive decision. Editing is locked until then."
            : approvedAndUnchanged
              ? "Approved to publish. The PDF and EPUB exports are final."
              : changedSinceApproval
                ? "Edited since it was approved. Exports are marked DRAFT until it is approved again."
                : "Not approved. Revise it and send it for approval again."}
          {p.approvalRequestId && can(user.role, "approvals.view") && (
            <>
              {" "}
              <Link
                href={`/approvals/${p.approvalRequestId}`}
                className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
              >
                Approval request <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </>
          )}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>{word === "chapter" ? "Chapters" : "Sections"}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {p.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {word}s yet. Add the first one.</p>
              ) : (
                <ol className="flex flex-col gap-1.5" data-testid="section-list">
                  {p.sections.map((s, i) => {
                    const w = wordCount(s.body);
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2 rounded-[10px] px-2 py-1.5",
                          s.id === selected?.id && "bg-surface-hover",
                        )}
                      >
                        <Link
                          href={`/content/publishing/${p.id}?part=${s.id}`}
                          className="min-w-0 flex-1"
                          aria-current={s.id === selected?.id ? "true" : undefined}
                        >
                          <span className="block truncate text-sm font-medium">
                            {i + 1}. {s.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {w ? `${w.toLocaleString("en-US")} words` : "Not written yet"}
                          </span>
                        </Link>
                        {!locked && (
                          <MoveButtons
                            sectionId={s.id}
                            first={i === 0}
                            last={i === p.sections.length - 1}
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {!locked && <AddSectionForm publicationId={p.id} label={word} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Publish</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>{p.description}</p>
              {(p.status === "DRAFTING" || p.status === "REJECTED") && (
                <>
                  <p>
                    When every {word} is written, send it for approval. The compliance check runs on
                    the whole text and an executive decides.
                  </p>
                  <SubmitPublicationButton publicationId={p.id} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>
              {selected
                ? `${word === "chapter" ? "Chapter" : "Section"} ${p.sections.indexOf(selected) + 1}`
                : "Start writing"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <SectionEditor key={selected.id} section={selected} label={word} locked={locked} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Add a {word} on the left, or start a new publication with an AI outline.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
