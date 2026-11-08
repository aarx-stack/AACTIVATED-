import {
  BookOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  LayoutGrid,
  Library,
  List,
  Plus,
  Scale,
  Search,
  Shapes,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ParamSelect } from "@/components/forms/param-select";
import { SummarizeButton } from "@/components/knowledge/knowledge-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DocumentCategory } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import {
  ACCESS_LABEL,
  CATEGORY_LABEL,
  getDocument,
  listDocuments,
  SORTS,
  type DocumentSort,
} from "@/server/knowledge/service";

export const metadata: Metadata = { title: "Knowledge Library" };

const CATEGORY_ICON: Record<DocumentCategory, LucideIcon> = {
  POLICIES: FileText,
  TRAINING: GraduationCap,
  LEGAL_RESEARCH: Scale,
  BRAND: Shapes,
  PRODUCT_EDUCATION: BookOpen,
};

const ACCESS_TONE = {
  EXECUTIVE_ONLY: "neutral",
  ALL_STAFF: "info",
  ALL_USERS: "success",
} as const;

const readingTime = (words: number) => `${Math.max(1, Math.round(words / 200))} min read`;
const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Search = { q?: string; category?: string; doc?: string; sort?: string; view?: string };

function hrefWith(params: Search, patch: Partial<Search>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `/knowledge?${s}` : "/knowledge";
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("knowledge.view");
  const params = await searchParams;
  const category = Object.values(DocumentCategory).includes(params.category as DocumentCategory)
    ? (params.category as DocumentCategory)
    : null;
  const sort: DocumentSort = SORTS.includes(params.sort as DocumentSort)
    ? (params.sort as DocumentSort)
    : "relevant";
  const view = params.view === "list" ? "list" : "grid";
  const q = params.q?.trim() || undefined;

  const { documents, counts, total } = await listDocuments(user, { q, category, sort });
  // The panel shows the chosen document, or the first result. getDocument re-checks access.
  const selectedId = params.doc ?? documents[0]?.id;
  const selected = selectedId ? await getDocument(user, selectedId) : null;
  const manage = can(user.role, "knowledge.manage");

  const visibleCategories = Object.values(DocumentCategory).filter((c) => (counts[c] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Knowledge Library"
        description="Company knowledge in one place. Search, browse by category and read an AI summary of any document you have access to."
        actions={
          manage ? (
            <Button asChild>
              <Link href="/knowledge/new">
                <Plus aria-hidden /> Add document
              </Link>
            </Button>
          ) : undefined
        }
      />

      <form
        action="/knowledge"
        role="search"
        className="glass flex items-center gap-2 rounded-pill p-1.5 pl-5"
      >
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor="knowledge-search" className="sr-only">
          Search knowledge
        </label>
        <input
          id="knowledge-search"
          name="q"
          defaultValue={q}
          placeholder="Search knowledge (e.g. posting rules, onboarding, consent, brand voice)"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <Button type="submit" className="rounded-pill px-6">
          Search
        </Button>
      </form>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_340px]">
        <Card className="h-fit p-4">
          <h2 className="mb-3 px-2 text-base font-semibold">Categories</h2>
          <nav aria-label="Categories">
            <ul className="flex flex-col gap-1">
              <CategoryLink
                href={hrefWith(params, { category: undefined, doc: undefined })}
                active={!category}
                icon={Library}
                label="All documents"
                count={total}
              />
              {visibleCategories.map((c) => (
                <CategoryLink
                  key={c}
                  href={hrefWith(params, { category: c, doc: undefined })}
                  active={category === c}
                  icon={CATEGORY_ICON[c]}
                  label={CATEGORY_LABEL[c]}
                  count={counts[c] ?? 0}
                />
              ))}
            </ul>
          </nav>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">
                {q ? `Results for “${q}”` : category ? CATEGORY_LABEL[category] : "All documents"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {documents.length} {documents.length === 1 ? "document" : "documents"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ParamSelect
                id="knowledge-sort"
                param="sort"
                label="Sort"
                value={sort}
                options={[
                  { value: "relevant", label: "Sort: Most relevant" },
                  { value: "recent", label: "Sort: Recently updated" },
                  { value: "title", label: "Sort: Title A–Z" },
                ]}
              />
              <div className="glass flex rounded-control p-0.5" role="group" aria-label="View">
                <ViewLink
                  href={hrefWith(params, { view: undefined })}
                  active={view === "grid"}
                  label="Grid view"
                  icon={LayoutGrid}
                />
                <ViewLink
                  href={hrefWith(params, { view: "list" })}
                  active={view === "list"}
                  label="List view"
                  icon={List}
                />
              </div>
            </div>
          </div>

          {documents.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing matches{q ? ` “${q}”` : ""}. Try another word or category.
            </p>
          ) : (
            <ul
              data-testid="documents"
              className={cn(
                view === "grid"
                  ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  : "flex flex-col gap-2",
              )}
            >
              {documents.map((d) => {
                const Icon = CATEGORY_ICON[d.category];
                const active = selected?.id === d.id;
                return (
                  <li key={d.id}>
                    <Link
                      href={hrefWith(params, { doc: d.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex h-full gap-3 tile p-4 transition-shadow hover:shadow-glow-soft",
                        view === "grid" ? "flex-col" : "flex-row items-center",
                        active && "border-[var(--border-strong)] shadow-glow",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        {view === "grid" && (
                          <Badge tone={ACCESS_TONE[d.accessLevel]}>
                            {ACCESS_LABEL[d.accessLevel]}
                          </Badge>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <p className="leading-snug font-semibold">{d.title}</p>
                        {view === "grid" && (
                          <p className="line-clamp-3 text-sm text-muted-foreground">
                            {d.summary ?? "No AI summary yet."}
                          </p>
                        )}
                        <p className="mt-auto pt-1 text-xs text-subtle-foreground">
                          {CATEGORY_LABEL[d.category]} · {readingTime(d.words)} · Updated{" "}
                          {shortDate(d.updatedAt)}
                        </p>
                      </div>
                      {view === "list" && (
                        <Badge tone={ACCESS_TONE[d.accessLevel]}>
                          {ACCESS_LABEL[d.accessLevel]}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit p-5 lg:col-span-2 2xl:col-span-1" data-testid="ai-summary">
          <h2 className="text-lg font-bold">AI Summary</h2>
          <p className="text-xs text-muted-foreground">
            AI-generated overview of the selected document.
          </p>
          {selected ? (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex items-start gap-3 tile p-3">
                <FileText className="mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold">{selected.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[selected.category]} · {ACCESS_LABEL[selected.accessLevel]}
                  </p>
                </div>
              </div>
              {selected.summary ? (
                <>
                  <section>
                    <h3 className="mb-1 text-sm font-semibold">Summary</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selected.summary}
                    </p>
                  </section>
                  {selected.keyPoints.length > 0 && (
                    <section>
                      <h3 className="mb-1.5 text-sm font-semibold">Key Takeaways</h3>
                      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm marker:text-cyan">
                        {selected.keyPoints.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <p className="text-xs text-subtle-foreground">
                    Written by the Brain from the document text only
                    {selected.summarizedAt ? `, ${shortDate(selected.summarizedAt)}` : ""}. Check
                    the full document before relying on it.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This document has no AI summary yet.
                  {manage ? " Generate one below." : ""}
                </p>
              )}
              <div className="flex flex-col gap-3">
                <Button asChild className="w-full">
                  <Link href={`/knowledge/${selected.id}`}>
                    View full document <ExternalLink aria-hidden />
                  </Link>
                </Button>
                {manage && (
                  <SummarizeButton
                    // A new document gets a fresh form: no message left over from another one.
                    key={selected.id}
                    documentId={selected.id}
                    label={selected.summary ? "Refresh summary" : "Generate summary"}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Select a document to see its summary.
            </p>
          )}
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-subtle-foreground">
        <Shield className="size-3.5" aria-hidden />
        You see only documents your role may read. Legal research and other confidential documents
        are executive-only.
      </p>
    </div>
  );
}

function CategoryLink({
  href,
  active,
  icon: Icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-control border px-2.5 py-2 text-sm font-medium",
          active
            ? "border-[rgba(140,200,255,0.75)] fill-primary"
            : "border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-xs tabular-nums">{count}</span>
      </Link>
    </li>
  );
}

function ViewLink({
  href,
  active,
  label,
  icon: Icon,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex size-8 items-center justify-center rounded-[10px]",
        active ? "fill-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </Link>
  );
}
