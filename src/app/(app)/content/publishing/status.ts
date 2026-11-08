import type { PublicationStatus } from "@/generated/prisma/enums";

export const PUBLICATION_STATUS: Record<
  PublicationStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }
> = {
  DRAFTING: { label: "Drafting", tone: "neutral" },
  IN_REVIEW: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved to publish", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
};
