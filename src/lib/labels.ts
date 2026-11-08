import type {
  ApprovalStatus,
  ApprovalType,
  ComplianceOutcome,
  ContentChannel,
  ContentStatus,
  RiskLevel,
  TaskStatus,
} from "@/generated/prisma/enums";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const RISK: Record<RiskLevel, { label: string; tone: Tone }> = {
  LOW: { label: "Low risk", tone: "success" },
  MEDIUM: { label: "Medium risk", tone: "warning" },
  HIGH: { label: "High risk", tone: "danger" },
  CRITICAL: { label: "Critical risk", tone: "danger" },
};

export const OUTCOME: Record<ComplianceOutcome, { label: string; tone: Tone }> = {
  PASS: { label: "Compliance passed", tone: "success" },
  WARN: { label: "Compliance warnings", tone: "warning" },
  FAIL: { label: "Compliance failed", tone: "danger" },
};

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};

export const APPROVAL_TYPE: Record<ApprovalType, string> = {
  SOCIAL_POST: "Social post",
  EMAIL: "Email",
  DIRECT_MESSAGE: "Direct message",
  SPEND: "Spend",
  PAYMENT: "Payment",
  SITE_CHANGE: "Site change",
  LEGAL: "Legal",
  OUTSIDE_WORK: "Outside work",
  PROJECT_LAUNCH: "Project launch",
  BUDGET_CHANGE: "Budget change",
  PUBLICATION: "Publication",
};

export const CHANNEL: Record<ContentChannel, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  EMAIL: "Email",
};

export const CONTENT_STATUS: Record<ContentStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  IN_REVIEW: { label: "In review", tone: "info" },
  APPROVED: { label: "Approved · ready to schedule", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "success" },
  PUBLISHED: { label: "Published", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  BACKLOG: { label: "Backlog", tone: "neutral" },
  TODO: { label: "To do", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  BLOCKED: { label: "Blocked", tone: "danger" },
  IN_REVIEW: { label: "In review", tone: "warning" },
  DONE: { label: "Done", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Plain-English names for audit actions shown in trails. */
export const AUDIT_ACTION: Record<string, string> = {
  "workflow.requested": "Requested content from the Brain",
  "brain.planned": "Planned the work",
  "task.delegated": "Delegated to the Operations Manager",
  "task.assigned": "Assigned the draft to the Content Specialist",
  "content.drafted": "Drafted the content",
  "compliance.checked": "Ran the compliance check",
  "approval.requested": "Submitted to the Approval Queue",
  "approval.edited": "Edited the content (new revision)",
  "approval.approved": "Approved",
  "approval.rejected": "Rejected",
  "content.ready_to_schedule": "Marked ready to schedule",
  "content.rejected": "Marked rejected",
  "workflow.blocked": "Workflow stopped",
};

export function auditLabel(action: string) {
  return AUDIT_ACTION[action] ?? action;
}
