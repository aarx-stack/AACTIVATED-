import "server-only";
import { AgentKind, type Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { canOpenAgentWorkspace, canViewDepartmentDetail } from "@/server/authz/policies";

export async function getCompanyTeam(role: Role) {
  const [brain, departments] = await Promise.all([
    db.agent.findFirst({
      where: { kind: AgentKind.BRAIN },
      include: { owner: { select: { name: true, title: true } } },
    }),
    db.department.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        owner: { select: { name: true } },
        agents: {
          where: { kind: AgentKind.DEPARTMENT },
          orderBy: { name: "asc" },
          include: { owner: { select: { name: true } } },
        },
      },
    }),
  ]);

  return {
    brain: brain && {
      id: brain.id,
      name: brain.name,
      title: brain.title,
      status: brain.status,
      currentFocus: brain.currentFocus,
      owner: brain.owner.name,
      ownerTitle: brain.owner.title,
    },
    departments: departments.map((d) => {
      const canViewDetail = canViewDepartmentDetail(role, d);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        isConfidential: d.isConfidential,
        canViewDetail,
        owner: d.owner?.name ?? null,
        agents: d.agents.map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          status: a.status,
          owner: a.owner.name,
          // A confidential agent's current focus is withheld from non-executives.
          currentFocus: canViewDetail ? a.currentFocus : null,
          canOpen: canOpenAgentWorkspace(role, { department: d }),
        })),
      };
    }),
  };
}

export type CompanyTeam = Awaited<ReturnType<typeof getCompanyTeam>>;
