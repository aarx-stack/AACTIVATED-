import { FilePlus2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PromptWorkbench } from "@/components/prompts/workbench";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/server/auth/session";
import { WORKING_STATUSES } from "@/server/agents/runner";
import { assignableAgents, getTemplate, listTemplates } from "@/server/prompts/service";

export const metadata: Metadata = { title: "Prompt Generator" };

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; q?: string }>;
}) {
  const user = await requirePagePermission("prompts.use");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const [templates, agents] = await Promise.all([listTemplates(user, q), assignableAgents(user)]);
  const isNew = params.template === "new";
  const selectedId = isNew ? null : (params.template ?? templates[0]?.id ?? null);
  const selected = selectedId ? await getTemplate(user, selectedId) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Prompt Generator"
        description="Create, refine and manage reusable prompts with the Brain, then hand them to an agent as a task."
        actions={
          <Button asChild variant="secondary">
            <Link href="/prompts?template=new">
              <FilePlus2 aria-hidden /> New prompt
            </Link>
          </Button>
        }
      />
      <PromptWorkbench
        // A fresh editor whenever the selected template or its version changes.
        key={selected ? `${selected.id}:${selected.currentVersion}` : "new"}
        q={q}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          currentVersion: t.currentVersion,
          department: t.department?.name ?? null,
        }))}
        selected={
          selected
            ? {
                id: selected.id,
                name: selected.name,
                description: selected.description,
                body: selected.body,
                currentVersion: selected.currentVersion,
                versions: selected.versions.map((v) => ({
                  version: v.version,
                  changeNote: v.changeNote,
                  createdAt: v.createdAt.toISOString(),
                  createdBy: v.createdBy?.name ?? null,
                })),
              }
            : null
        }
        agents={agents.map((a) => ({
          id: a.id,
          label: `${a.title} (${a.name})${a.department ? ` · ${a.department.name}` : ""}`,
          available: WORKING_STATUSES.includes(a.status),
        }))}
      />
    </div>
  );
}
