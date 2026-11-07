import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ComingSoon } from "@/components/shell/coming-soon";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/session";
import { canOpenAgentWorkspace } from "@/server/authz/policies";

export const metadata: Metadata = { title: "Agent Workspace" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("agent.view");
  const { id } = await params;
  const agent = await db.agent.findUnique({
    where: { id },
    select: { name: true, title: true, department: { select: { isConfidential: true } } },
  });
  if (!agent) notFound();
  // Confidential departments (Legal, Finance, HR) are executive-only — enforced here, not just hidden.
  if (!canOpenAgentWorkspace(user.role, agent)) redirect("/forbidden");

  return (
    <ComingSoon
      title={`${agent.title}: ${agent.name}`}
      phase={2}
      description="This agent's full workspace arrives with the first end-to-end workflow."
      scope={[
        "ROLE, CONTEXT, DAILY ROUTINE, TASKS, HANDOFF and REPORT tabs",
        "Task kanban, handoff timeline, outputs and a performance chart",
      ]}
    />
  );
}
