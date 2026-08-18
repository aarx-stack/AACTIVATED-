import { db } from './db'

export async function logAudit(opts: {
  organizationId: string
  userId?: string | null
  action: string
  targetType?: string
  targetId?: string
  oldValue?: unknown
  newValue?: unknown
  ipAddress?: string | null
}) {
  await db.auditLog.create({
    data: {
      organizationId: opts.organizationId,
      userId: opts.userId ?? null,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      oldValue: opts.oldValue != null ? JSON.stringify(opts.oldValue) : null,
      newValue: opts.newValue != null ? JSON.stringify(opts.newValue) : null,
      ipAddress: opts.ipAddress ?? null,
    },
  })
}
