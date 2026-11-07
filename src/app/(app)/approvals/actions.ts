"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApprovalConflictError, decideApproval, editApproval } from "@/server/approvals/service";
import { requireActionPermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";
import type { ruleInputSchema } from "@/server/compliance/service";
import { createComplianceRule, setComplianceRuleActive } from "@/server/compliance/service";

export type ApprovalActionState =
  { status: "idle" } | { status: "error"; message: string } | { status: "done"; message: string };

function fail(error: unknown): ApprovalActionState {
  if (error instanceof ForbiddenError || error instanceof ApprovalConflictError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof z.ZodError) {
    return { status: "error", message: error.issues[0]?.message ?? "Check the form." };
  }
  console.error("[approvals]", error);
  return { status: "error", message: "Something went wrong. Nothing was changed." };
}

function refresh(id?: string) {
  revalidatePath("/approvals");
  if (id) revalidatePath(`/approvals/${id}`);
  revalidatePath("/command-center");
}

export async function decideAction(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    const actor = await requireActionPermission("approvals.decide_standard");
    const decision = String(formData.get("decision")) as "APPROVE" | "REJECT";
    const note = String(formData.get("note") ?? "").trim() || undefined;
    const result = await decideApproval(actor, id, { decision, note });
    refresh(id);
    return {
      status: "done",
      message:
        result.status === "APPROVED"
          ? "Approved. The content is ready to schedule."
          : "Rejected. The agent has been told.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function editAction(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    const actor = await requireActionPermission("approvals.decide_standard");
    const hashtags = String(formData.get("hashtags") ?? "")
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`));
    const result = await editApproval(actor, id, {
      title: String(formData.get("title") ?? ""),
      caption: String(formData.get("caption") ?? ""),
      hashtags,
    });
    refresh(id);
    return {
      status: "done",
      message:
        result.outcome === "PASS"
          ? "Saved. Compliance re-check passed."
          : `Saved. Compliance re-check: ${result.violations.length} finding${result.violations.length === 1 ? "" : "s"} (${result.risk.toLowerCase()} risk).`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function createRuleAction(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  try {
    const actor = await requireActionPermission("compliance_rules.manage");
    // Shape only; ruleInputSchema validates every field (enums included) on the server.
    const input = {
      type: formData.get("type"),
      pattern: String(formData.get("pattern") ?? ""),
      isRegex: formData.get("isRegex") === "on",
      channels: formData.getAll("channels").map(String),
      severity: formData.get("severity"),
      description: String(formData.get("description") ?? ""),
      suggestion: String(formData.get("suggestion") ?? "").trim() || undefined,
    } as unknown as z.input<typeof ruleInputSchema>;
    await createComplianceRule(actor, input);
    revalidatePath("/approvals/rules");
    return { status: "done", message: "Rule added. It applies to every check from now on." };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleRuleAction(
  ruleId: string,
  active: boolean,
): Promise<ApprovalActionState> {
  try {
    const actor = await requireActionPermission("compliance_rules.manage");
    await setComplianceRuleActive(actor, ruleId, active);
    revalidatePath("/approvals/rules");
    return { status: "done", message: active ? "Rule enabled." : "Rule disabled." };
  } catch (error) {
    return fail(error);
  }
}
