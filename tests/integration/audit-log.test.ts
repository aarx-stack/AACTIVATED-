import { afterAll, describe, expect, it } from "vitest";
import { recordAudit } from "@/server/audit/audit";
import { db } from "./helpers";

afterAll(() => db.$disconnect());

describe("AuditLog is append-only (database trigger)", () => {
  it("accepts inserts with before/after snapshots", async () => {
    const entry = await recordAudit(db, {
      actor: { type: "SYSTEM" },
      action: "test.inserted",
      entityType: "Test",
      before: { a: 1 },
      after: { a: 2, at: new Date("2026-01-01T00:00:00Z") },
    });
    expect(entry.after).toEqual({ a: 2, at: "2026-01-01T00:00:00.000Z" });
  });

  it("rejects UPDATE", async () => {
    const entry = await recordAudit(db, {
      actor: { type: "SYSTEM" },
      action: "test.update",
      entityType: "Test",
    });
    await expect(
      db.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    const entry = await recordAudit(db, {
      actor: { type: "SYSTEM" },
      action: "test.delete",
      entityType: "Test",
    });
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(db.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/);
  });

  it("rolls back the audit entry together with a failed transaction", async () => {
    const before = await db.auditLog.count();
    await expect(
      db.$transaction(async (tx) => {
        await recordAudit(tx, {
          actor: { type: "SYSTEM" },
          action: "test.rollback",
          entityType: "Test",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.auditLog.count()).toBe(before);
  });
});
