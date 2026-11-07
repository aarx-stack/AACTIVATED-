/**
 * Every external system sits behind an interface. Mock adapters are the default;
 * live adapters are switched on per integration with an env flag and stay
 * read-only/off until executive approval (Phase 5).
 *
 * Outbound actions (posting, messaging, paying) are added in Phase 2 and will
 * require an approved ApprovalRequest — see src/server/approvals.
 */
import type { HealthStatus } from "@/generated/prisma/enums";

export type IntegrationKey = "GOHIGHLEVEL" | "QUICKBOOKS" | "SLACK";

export interface HealthResult {
  status: HealthStatus;
  latencyMs: number;
  message: string;
}

export interface IntegrationAdapter {
  readonly key: IntegrationKey;
  readonly mode: "mock" | "live";
  healthCheck(): Promise<HealthResult>;
}

export interface GoHighLevelAdapter extends IntegrationAdapter {
  key: "GOHIGHLEVEL";
  /** One sub-account per Premium rep. */
  listSubAccounts(): Promise<{ id: string; name: string }[]>;
  /**
   * Outbound. Only ever called after assertDispatchable() has verified the
   * approval and the exact payload (see src/server/content/studio.ts).
   */
  schedulePost(input: {
    subAccountId: string;
    channel: string;
    caption: string;
    hashtags: string[];
    scheduledFor: Date;
  }): Promise<{ externalId: string }>;
  /** Outbound message to a consented contact. Same rule: approval first. */
  sendMessage(input: {
    subAccountId: string;
    contactId: string;
    channel: string;
    subject?: string;
    message: string;
  }): Promise<{ externalId: string }>;
}

export class IntegrationUnavailableError extends Error {
  readonly status = 503;
}

export interface QuickBooksAdapter extends IntegrationAdapter {
  key: "QUICKBOOKS";
  /** Read-only sync status. */
  lastSync(): Promise<{ syncedAt: Date | null; transactionCount: number }>;
}

export interface SlackAdapter extends IntegrationAdapter {
  key: "SLACK";
  /** Internal team notification only — never customer-facing. */
  notify(channel: string, text: string): Promise<{ delivered: boolean }>;
}
