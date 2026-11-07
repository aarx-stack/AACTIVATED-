import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Agent Workspace" };

export default async function Page() {
  await requirePagePermission("agent.view");
  return (
    <ComingSoon
      title={"Agent Workspace"}
      phase={2}
      description={"Open one agent: its role, context, daily routine, tasks, handoffs and reports."}
      scope={[
        "ROLE, CONTEXT, DAILY ROUTINE, TASKS, HANDOFF and REPORT tabs",
        "Task kanban, handoff timeline, outputs and a performance chart",
        "Confidential departments open for executives only",
      ]}
    />
  );
}
