import "server-only";
import { z } from "zod";
import {
  ComplianceRuleType,
  ContentChannel,
  RiskLevel,
  type ComplianceOutcome,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/authz/permissions";
import { compileRule, evaluateContent, type ComplianceResult } from "./engine";

export async function loadActiveRules(client: DbClient = db) {
  return client.complianceRule.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
}

/** Runs the check and stores the result against the content item / approval. */
export async function runComplianceCheck(
  client: DbClient,
  input: {
    text: string;
    channel: ContentChannel;
    contentItemId?: string | null;
    approvalRequestId?: string | null;
  },
): Promise<ComplianceResult & { checkId: string }> {
  const rules = await loadActiveRules(client);
  const result = evaluateContent(input.text, input.channel, rules);
  const check = await client.complianceCheck.create({
    data: {
      contentItemId: input.contentItemId ?? null,
      approvalRequestId: input.approvalRequestId ?? null,
      outcome: result.outcome,
      risk: result.risk,
      violations: result.violations as unknown as Prisma.InputJsonValue,
    },
  });
  return { ...result, checkId: check.id };
}

export interface StoredViolation {
  ruleId?: string;
  type: ComplianceRuleType;
  match: string;
  index?: number;
  message: string;
  severity: RiskLevel;
  suggestion?: string | null;
}

export function readViolations(json: unknown): StoredViolation[] {
  return Array.isArray(json) ? (json as StoredViolation[]) : [];
}

export const OUTCOME_LABEL: Record<ComplianceOutcome, string> = {
  PASS: "Passed",
  WARN: "Warnings",
  FAIL: "Failed",
};

// ---------------------------------------------------------- rule management --

export const ruleInputSchema = z
  .object({
    type: z.enum(ComplianceRuleType),
    pattern: z.string().trim().min(2, "Enter a term or pattern.").max(200),
    isRegex: z.boolean().default(false),
    channels: z.array(z.enum(ContentChannel)).default([]),
    severity: z.enum(RiskLevel),
    description: z.string().trim().min(3, "Describe why this is flagged.").max(200),
    suggestion: z.string().trim().max(200).optional(),
  })
  .refine((r) => compileRule(r) !== null, {
    message: "That regular expression is not valid.",
    path: ["pattern"],
  });

export async function createComplianceRule(
  actor: Actor,
  input: z.input<typeof ruleInputSchema>,
  client: Db = db,
) {
  authorize(actor, "compliance_rules.manage");
  const data = ruleInputSchema.parse(input);
  return client.$transaction(async (tx) => {
    const rule = await tx.complianceRule.create({ data: { ...data, createdById: actor.id } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "compliance_rule.created",
      entityType: "ComplianceRule",
      entityId: rule.id,
      after: data,
    });
    return rule;
  });
}

export async function setComplianceRuleActive(
  actor: Actor,
  ruleId: string,
  active: boolean,
  client: Db = db,
) {
  authorize(actor, "compliance_rules.manage");
  return client.$transaction(async (tx) => {
    const before = await tx.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
    const rule = await tx.complianceRule.update({ where: { id: ruleId }, data: { active } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: active ? "compliance_rule.enabled" : "compliance_rule.disabled",
      entityType: "ComplianceRule",
      entityId: ruleId,
      before: { active: before.active },
      after: { active },
    });
    return rule;
  });
}
