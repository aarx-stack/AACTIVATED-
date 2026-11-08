import type { CampaignStatus } from "@/generated/prisma/enums";

export const CAMPAIGN_STATUS: Record<
  CampaignStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  IN_REVIEW: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved · ready to send", tone: "info" },
  SENDING: { label: "Sending", tone: "info" },
  SENT: { label: "Sent", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};
