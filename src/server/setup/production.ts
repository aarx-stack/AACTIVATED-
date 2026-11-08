/**
 * Production setup: builds the real company in an empty database. No demo data.
 *
 * Creates (only what is missing, so it is safe to run again):
 *   - the first executive and the system admin (they sign in with their emailed link),
 *   - the 13 departments, the Brain and the department agents,
 *   - the rep agent templates (needed for rep onboarding),
 *   - the starter compliance rules (placeholders to review),
 *   - the prompt library, the integration rows (all mock),
 *   - personal assistants for both people,
 *   - a company AI budget for this month (carried over every month).
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AgentKind, Role, SpendKind } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { syncPersonalAssistant } from "@/server/agents/assistants";
import { recordAudit } from "@/server/audit/audit";
import { monthPeriod } from "@/server/budgets/service";
import {
  BRAIN,
  COMPANY_AGENTS,
  COMPLIANCE_RULES,
  DEPARTMENTS,
  departmentAgentConfig,
  INTEGRATIONS,
  type OwnerKey,
  PROMPT_LIBRARY,
  REP_TEMPLATES,
} from "../../../prisma/catalog";

export const setupSchema = z.object({
  executiveName: z.string().trim().min(2, "Set SETUP_EXECUTIVE_NAME."),
  executiveEmail: z.string().trim().toLowerCase().email("Set SETUP_EXECUTIVE_EMAIL."),
  adminName: z.string().trim().min(2, "Set SETUP_ADMIN_NAME."),
  adminEmail: z.string().trim().toLowerCase().email("Set SETUP_ADMIN_EMAIL."),
  aiBudgetUsd: z.coerce.number().positive().max(1_000_000).default(200),
});

export class DemoDataError extends Error {}

export async function setupProduction(client: Db, input: z.input<typeof setupSchema>) {
  const data = setupSchema.parse(input);
  if (data.executiveEmail === data.adminEmail) {
    throw new Error("The executive and the system admin need different email addresses.");
  }
  // Never mix the real company with the demo company.
  if (await client.user.findFirst({ where: { email: { endsWith: "@aactivated.test" } } })) {
    throw new DemoDataError(
      "This database contains the demo data. Use a new, empty database for production.",
    );
  }

  const summary: Record<string, number> = {};
  const count = (key: string) => (summary[key] = (summary[key] ?? 0) + 1);

  return client.$transaction(
    async (tx) => {
      const person = async (name: string, email: string, role: Role) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) return existing;
        count("people");
        return tx.user.create({ data: { name, email, role, status: "INVITED" } });
      };
      const exec = await person(data.executiveName, data.executiveEmail, Role.EXECUTIVE);
      const admin = await person(data.adminName, data.adminEmail, Role.SYSTEM_ADMIN);
      // Demo ownership maps to real people: technology belongs to the admin, the rest to the
      // executive until real owners are assigned.
      const ownerFor = (key: OwnerKey) => (key === "isaac" ? admin.id : exec.id);

      const depts: Record<string, { id: string; name: string }> = {};
      for (const [i, d] of DEPARTMENTS.entries()) {
        const existing = await tx.department.findUnique({ where: { slug: d.slug } });
        depts[d.slug] =
          existing ??
          (count("departments"),
          await tx.department.create({
            data: {
              slug: d.slug,
              name: d.name,
              description: d.description,
              sortOrder: i,
              isConfidential: d.confidential,
              ownerId: ownerFor(d.owner),
            },
          }));
      }

      for (const d of DEPARTMENTS) {
        if ("parent" in d) {
          await tx.department.update({
            where: { id: depts[d.slug]!.id },
            data: { parentId: depts[d.parent]!.id },
          });
        }
      }

      if (!(await tx.agent.findUnique({ where: { slug: BRAIN.slug } }))) {
        count("agents");
        await tx.agent.create({
          data: {
            slug: BRAIN.slug,
            name: BRAIN.name,
            title: BRAIN.title,
            kind: AgentKind.BRAIN,
            status: "ACTIVE",
            ownerId: exec.id,
            monthlyBudgetUsd: new Prisma.Decimal(BRAIN.monthlyBudgetUsd),
            currentFocus: "Ready for the first day.",
            config: BRAIN.config,
          },
        });
      }
      for (const a of COMPANY_AGENTS) {
        if (await tx.agent.findUnique({ where: { slug: a.slug } })) continue;
        count("agents");
        const dept = depts[a.dept]!;
        await tx.agent.create({
          data: {
            slug: a.slug,
            name: a.name,
            title: a.title,
            kind: AgentKind.DEPARTMENT,
            // Agents start ready; the demo statuses (paused, error) do not carry over.
            status: "IDLE",
            departmentId: dept.id,
            ownerId: ownerFor(a.owner),
            monthlyBudgetUsd: new Prisma.Decimal(80),
            currentFocus: "Ready for work.",
            config: departmentAgentConfig(a.title, dept.name, a.tools),
          },
        });
      }

      for (const t of REP_TEMPLATES) {
        if (await tx.agentTemplate.findUnique({ where: { key: t.key } })) continue;
        count("rep agent templates");
        const latest = t.versions[t.versions.length - 1]!;
        const template = await tx.agentTemplate.create({
          data: { key: t.key, name: t.name, repRole: t.repRole, currentVersion: 1 },
        });
        await tx.agentTemplateVersion.create({
          data: {
            templateId: template.id,
            version: 1,
            role: latest.role,
            context: latest.context,
            dailyRoutine: latest.dailyRoutine,
            toolsAllowed: latest.tools,
            changeNote: "Initial version.",
            createdById: exec.id,
          },
        });
      }

      if ((await tx.complianceRule.count()) === 0) {
        for (const r of COMPLIANCE_RULES) {
          count("compliance rules");
          await tx.complianceRule.create({
            data: {
              type: r.type,
              pattern: r.pattern,
              isRegex: r.isRegex ?? false,
              channels: r.channels ?? [],
              severity: r.severity,
              description: r.description,
              suggestion: r.suggestion,
              createdById: exec.id,
            },
          });
        }
      }

      for (const t of PROMPT_LIBRARY) {
        if (await tx.promptTemplate.findUnique({ where: { key: t.key } })) continue;
        count("prompt templates");
        const latest = t.versions[t.versions.length - 1]!;
        const created = await tx.promptTemplate.create({
          data: {
            key: t.key,
            name: t.name,
            description: t.description,
            variables: [
              ...new Set(
                [...latest.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!),
              ),
            ],
            currentVersion: 1,
            departmentId: t.dept ? depts[t.dept]!.id : null,
          },
        });
        await tx.promptTemplateVersion.create({
          data: {
            templateId: created.id,
            version: 1,
            body: latest.body,
            changeNote: "Initial template",
            createdById: exec.id,
          },
        });
      }

      for (const i of INTEGRATIONS) {
        if (await tx.integration.findUnique({ where: { provider: i.provider } })) continue;
        count("integrations");
        await tx.integration.create({
          data: { provider: i.provider, name: i.name, description: i.description, mode: "MOCK" },
        });
      }

      await syncPersonalAssistant(tx, exec);
      await syncPersonalAssistant(tx, admin);

      const now = new Date();
      const { start, end } = monthPeriod(now);
      const hasBudget = await tx.budget.findFirst({
        where: { periodStart: { lte: now }, periodEnd: { gte: now } },
      });
      if (!hasBudget) {
        count("budgets");
        await tx.budget.create({
          data: {
            name: "AI models (company)",
            kind: SpendKind.AI_MODEL,
            periodStart: start,
            periodEnd: end,
            limitUsd: new Prisma.Decimal(data.aiBudgetUsd.toFixed(2)),
          },
        });
      }

      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "system.production_setup",
        entityType: "System",
        entityId: null,
        metadata: { created: summary },
      });
      return { executive: exec, admin, created: summary };
    },
    { timeout: 60_000 },
  );
}
