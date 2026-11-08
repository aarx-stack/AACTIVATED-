/**
 * Live QuickBooks Online adapter: READ-ONLY. It only issues GET requests (company info and
 * queries); nothing is ever written to QuickBooks.
 *
 * Authentication: `auth()` supplies the company id and a current OAuth access token. With
 * "Connect QuickBooks" that comes from the encrypted connection, renewed automatically
 * (quickbooks-connection.ts); for a quick sandbox test it can be a fixed token from the
 * environment.
 */
import { HealthStatus } from "@/generated/prisma/enums";
import type { ImportedTransaction, QuickBooksAdapter } from "../types";
import { callJson, type FetchLike, timed } from "./http";

export const QB_BASE_URL = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
} as const;
const MINOR_VERSION = "75";

export interface QuickBooksConfig {
  auth: () => Promise<{ realmId: string; accessToken: string }>;
  environment: keyof typeof QB_BASE_URL;
  fetch?: FetchLike;
}

interface QbTxn {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  PrivateNote?: string;
  EntityRef?: { name?: string };
  CustomerRef?: { name?: string };
  AccountRef?: { name?: string };
  DepositToAccountRef?: { name?: string };
}

/** QuickBooks entity -> how it counts here. */
const ENTITIES = [
  { entity: "Purchase", type: "EXPENSE" },
  { entity: "SalesReceipt", type: "REVENUE" },
  { entity: "Payment", type: "REVENUE" },
  { entity: "RefundReceipt", type: "REFUND" },
] as const;

export function toImported(
  entity: (typeof ENTITIES)[number]["entity"],
  type: ImportedTransaction["type"],
  t: QbTxn,
): ImportedTransaction {
  const party = t.EntityRef?.name ?? t.CustomerRef?.name;
  return {
    externalId: `qb-${entity.toLowerCase()}-${t.Id}`,
    occurredAt: new Date(`${t.TxnDate}T12:00:00Z`),
    description: t.PrivateNote?.trim() || party || entity.replace(/([a-z])([A-Z])/g, "$1 $2"),
    category:
      type === "EXPENSE"
        ? (t.AccountRef?.name ?? "Uncategorized")
        : type === "REFUND"
          ? "Refunds"
          : "Sales",
    type,
    amountUsd: Math.abs(Number(t.TotalAmt) || 0),
  };
}

export function createLiveQuickBooks(config: QuickBooksConfig): QuickBooksAdapter {
  // The only request this adapter can make: a GET. There is no write path to QuickBooks.
  const get = async <T>(path: (realmId: string) => string) => {
    const { realmId, accessToken } = await config.auth();
    const base = `${QB_BASE_URL[config.environment]}/v3/company/${encodeURIComponent(realmId)}`;
    const rel = path(realmId);
    return callJson<T>(
      "QuickBooks",
      `${base}${rel}${rel.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      },
      config.fetch,
    );
  };

  return {
    key: "QUICKBOOKS",
    mode: "live",

    async healthCheck() {
      try {
        const [, ms] = await timed(() =>
          get((realmId) => `/companyinfo/${encodeURIComponent(realmId)}`),
        );
        return {
          status: HealthStatus.OPERATIONAL,
          latencyMs: ms,
          message: "Connected (live, read-only).",
        };
      } catch (error) {
        return {
          status: HealthStatus.DOWN,
          latencyMs: 0,
          message: error instanceof Error ? error.message : "Unavailable.",
        };
      }
    },

    async lastSync() {
      const txns = await this.fetchTransactions(new Date(Date.now() - 30 * 86_400_000));
      return { syncedAt: new Date(), transactionCount: txns.length };
    },

    async fetchTransactions(since: Date) {
      const day = since.toISOString().slice(0, 10);
      const results: ImportedTransaction[] = [];
      for (const { entity, type } of ENTITIES) {
        const query = `select * from ${entity} where TxnDate >= '${day}' maxresults 1000`;
        const data = await get<{ QueryResponse?: Record<string, QbTxn[] | undefined> }>(
          () => `/query?query=${encodeURIComponent(query)}`,
        );
        for (const t of data.QueryResponse?.[entity] ?? [])
          results.push(toImported(entity, type, t));
      }
      return results;
    },
  };
}
