import { Prisma } from "@/generated/prisma/client";
import { ActorType } from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db";

export type AuditActor =
  { type: "USER"; userId: string } | { type: "AGENT"; agentId: string } | { type: "SYSTEM" };

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/** Converts Dates/Decimals/undefined into plain JSON for storage. */
export function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Append an audit entry. Pass the transaction client so the entry commits
 * (or rolls back) together with the change it describes.
 */
export async function recordAudit(client: DbClient, entry: AuditEntry) {
  return client.auditLog.create({
    data: {
      actorType: ActorType[entry.actor.type],
      actorUserId: entry.actor.type === "USER" ? entry.actor.userId : null,
      actorAgentId: entry.actor.type === "AGENT" ? entry.actor.agentId : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      metadata: toJson(entry.metadata),
    },
  });
}
