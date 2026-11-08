import { execSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { createPrismaClient } from "@/lib/db";
import { ForbiddenError } from "@/server/authz/permissions";
import { createBudget, ensureMonthlyBudgets, findBudgetFor } from "@/server/budgets/service";
import { DemoDataError, setupProduction } from "@/server/setup/production";
import { createUser, db } from "./helpers";

/** A separate, empty database: production setup must work on one. */
const base = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/aactivated_test?schema=public",
);
const setupUrl = new URL(base);
setupUrl.pathname = "/aactivated_setup_test";
const admin = new URL(base);
admin.pathname = "/postgres";
admin.search = "";

let fresh: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query("DROP DATABASE IF EXISTS aactivated_setup_test WITH (FORCE)");
  await c.query("CREATE DATABASE aactivated_setup_test");
  await c.end();
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: setupUrl.toString() },
  });
  fresh = createPrismaClient(setupUrl.toString().replace("?schema=public", ""));
}, 120_000);

afterAll(async () => {
  await fresh?.$disconnect();
  await db.$disconnect();
});

const people = {
  executiveName: "Guy Griffithe",
  executiveEmail: "guy@example.com",
  adminName: "Isaac Muniz",
  adminEmail: "isaac@example.com",
  aiBudgetUsd: 250,
};

describe("production setup", () => {
  it("builds the company in an empty database, with no demo data, and is safe to rerun", async () => {
    const first = await setupProduction(fresh, people);
    expect(first.created).toMatchObject({ people: 2, departments: 14, agents: 23, budgets: 1 });
    const credit = await fresh.department.findUniqueOrThrow({
      where: { slug: "credit-builder" },
      include: { parent: true },
    });
    expect(credit.parent?.slug).toBe("finance");
    expect(credit.isConfidential).toBe(true);

    const users = await fresh.user.findMany({ orderBy: { email: "asc" } });
    expect(users.map((u) => [u.email, u.role, u.status])).toEqual([
      ["guy@example.com", "EXECUTIVE", "INVITED"],
      ["isaac@example.com", "SYSTEM_ADMIN", "INVITED"],
    ]);
    expect(await fresh.agent.count({ where: { kind: "PERSONAL" } })).toBe(2);
    expect(await fresh.agent.count({ where: { kind: "REP_POD" } })).toBe(0);
    expect(await fresh.agentTemplate.count()).toBe(4);
    expect(await fresh.complianceRule.count()).toBeGreaterThan(0);
    for (const table of ["transaction", "contentItem", "contact", "approvalRequest"] as const) {
      expect(await (fresh[table] as { count: () => Promise<number> }).count()).toBe(0);
    }
    const budget = await fresh.budget.findFirstOrThrow();
    expect(Number(budget.limitUsd)).toBe(250);

    const again = await setupProduction(fresh, people);
    expect(again.created).toEqual({});
    expect(await fresh.agent.count()).toBe(25); // the Brain, 22 department agents, 2 assistants
  });

  it("refuses a database that holds the demo company", async () => {
    await fresh.user.create({
      data: { email: "maya@aactivated.test", name: "Maya", role: "STAFF" },
    });
    await expect(setupProduction(fresh, people)).rejects.toBeInstanceOf(DemoDataError);
    await fresh.user.delete({ where: { email: "maya@aactivated.test" } });
  });
});

describe("monthly budgets", () => {
  it("carry over into the next month with the same limit; ended budgets do not come back", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const dept = await db.department.create({
      data: { slug: `roll-${tag}`, name: `Roll ${tag}`, description: "test" },
    });
    // A full month far from today, so other tests' budgets are not involved.
    const jan = new Date(2031, 0, 1);
    const janEnd = new Date(2031, 1, 0, 23, 59, 59, 999);
    await db.budget.create({
      data: {
        name: `Ads ${tag}`,
        kind: "ADVERTISING",
        departmentId: dept.id,
        periodStart: jan,
        periodEnd: janEnd,
        limitUsd: 900,
        threshold: 0.75,
      },
    });
    // Ended early (mid-month): must not carry over.
    await db.budget.create({
      data: {
        name: `Old ${tag}`,
        kind: "OTHER",
        departmentId: dept.id,
        periodStart: jan,
        periodEnd: new Date(2031, 0, 15),
        limitUsd: 100,
      },
    });

    const feb10 = new Date(2031, 1, 10);
    // Spending in a new month finds the carried-over budget (created on first use).
    const found = await findBudgetFor(db, "ADVERTISING", dept.id, feb10);
    expect(found?.name).toBe(`Ads ${tag}`);
    expect(Number(found!.limitUsd)).toBe(900);
    expect(found!.periodStart.getTime()).toBe(new Date(2031, 1, 1).getTime());

    await ensureMonthlyBudgets(db, feb10);
    const feb = await db.budget.findMany({
      where: { departmentId: dept.id, periodStart: new Date(2031, 1, 1) },
    });
    expect(feb.map((b) => b.name)).toEqual([`Ads ${tag}`]);
    expect(
      await db.auditLog.count({ where: { action: "budget.rolled_over", entityId: feb[0]!.id } }),
    ).toBe(1);
  });

  it("only executives create budgets, and names are unique within a month", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const staff = await createUser(Role.STAFF);
    const name = `Events ${Math.random().toString(36).slice(2, 8)}`;
    await expect(
      createBudget(staff, { name, kind: "OTHER", limitUsd: 500 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const b = await createBudget(exec, { name, kind: "OTHER", limitUsd: 500 });
    expect(Number(b.limitUsd)).toBe(500);
    await expect(createBudget(exec, { name, kind: "OTHER", limitUsd: 600 })).rejects.toThrow(
      /already exists/,
    );
  });
});
