import { afterAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  addTradeline,
  CREDIT_PLAN,
  getCreditBuilder,
  recordScore,
  setTradelineStatus,
  updateMilestone,
} from "@/server/finance/credit";
import { createUser, db } from "./helpers";

afterAll(() => db.$disconnect());

describe("Credit Builder", () => {
  it("is executive-only, like the rest of Finance", async () => {
    for (const role of [Role.STAFF, Role.SYSTEM_ADMIN, Role.PREMIUM_REP]) {
      const user = await createUser(role);
      await expect(getCreditBuilder(user)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(recordScore(user, { bureau: "DNB_PAYDEX", score: 80 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("tracks the plan, reporting accounts and scores; refuses account numbers", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    let data = await getCreditBuilder(exec);
    expect(data.milestones).toHaveLength(CREDIT_PLAN.length);
    const duns = data.milestones.find((m) => m.key === "duns")!;

    await updateMilestone(exec, {
      id: duns.id,
      status: "DONE",
      notes: "Filed with corporate records.",
    });
    await expect(
      updateMilestone(exec, { id: duns.id, status: "DONE", notes: "EIN 12-3456789" }),
    ).rejects.toThrow(/account numbers/);
    data = await getCreditBuilder(exec);
    const after = data.milestones.find((m) => m.key === "duns")!;
    expect(after.status).toBe("DONE");
    expect(after.completedAt).not.toBeNull();
    expect(data.progress.done).toBeGreaterThanOrEqual(1);

    const before = data.reportingAccounts;
    const t = await addTradeline(exec, {
      vendor: `Supplies vendor ${Math.random().toString(36).slice(2, 8)}`,
      kind: "VENDOR_NET30",
      reportsTo: ["Dun & Bradstreet", "Experian"],
      limitUsd: 1500,
    });
    expect((await getCreditBuilder(exec)).reportingAccounts).toBe(before);
    await setTradelineStatus(exec, t.id, "OPEN");
    expect((await getCreditBuilder(exec)).reportingAccounts).toBe(before + 1);
    await expect(
      addTradeline(exec, {
        vendor: "Card",
        kind: "CREDIT_CARD",
        notes: "acct 4111 1111 1111 1111",
      }),
    ).rejects.toThrow(/account numbers/);

    await expect(recordScore(exec, { bureau: "DNB_PAYDEX", score: 120 })).rejects.toThrow(
      /from 0 to 100/,
    );
    await recordScore(exec, {
      bureau: "EQUIFAX_BUSINESS",
      score: 500,
      recordedAt: new Date(Date.now() - 40 * 86_400_000),
    });
    await recordScore(exec, { bureau: "EQUIFAX_BUSINESS", score: 530 });
    const latest = (await getCreditBuilder(exec)).latest.EQUIFAX_BUSINESS;
    expect(latest.latest?.score).toBe(530);
    expect(latest.previous?.score).toBe(500);
    expect(
      await db.auditLog.count({ where: { action: "credit.score_recorded", actorUserId: exec.id } }),
    ).toBe(2);
  });
});
