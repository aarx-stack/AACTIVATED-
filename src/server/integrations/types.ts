/**
 * Every external system sits behind an interface. Mock adapters are the default;
 * live adapters (src/server/integrations/live) are switched on per integration with an
 * INTEGRATION_* env flag plus credentials, and can be turned off from Admin at any time.
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
  /** The upstream HTTP status, when there was one (never shown to users). */
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** A transaction read from the accounting system (never written back). */
export interface ImportedTransaction {
  externalId: string;
  occurredAt: Date;
  description: string;
  category: string;
  type: "REVENUE" | "EXPENSE" | "REFUND";
  amountUsd: number;
}

export interface QuickBooksAdapter extends IntegrationAdapter {
  key: "QUICKBOOKS";
  /** Read-only sync status. */
  lastSync(): Promise<{ syncedAt: Date | null; transactionCount: number }>;
  /** Read-only: transactions dated on or after `since`. */
  fetchTransactions(since: Date): Promise<ImportedTransaction[]>;
}

export interface SlackAdapter extends IntegrationAdapter {
  key: "SLACK";
  /** Internal team notification only — never customer-facing. */
  notify(channel: string, text: string): Promise<{ delivered: boolean }>;
}
