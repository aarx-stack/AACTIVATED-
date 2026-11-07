import { afterAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { ForbiddenError, UnauthenticatedError } from "@/server/authz/permissions";
import { changeUserRole, inviteUser, setUserStatus } from "@/server/users/admin";
import { createUser, db } from "./helpers";

afterAll(() => db.$disconnect());

describe("changeUserRole (server-enforced)", () => {
  it("changes the role and writes an audit entry with before/after", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const rep = await createUser(Role.FREE_REP);

    const updated = await changeUserRole(exec, rep.id, Role.PREMIUM_REP);
    expect(updated.role).toBe(Role.PREMIUM_REP);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: rep.id, action: "user.role_changed" },
    });
    expect(audit.actorUserId).toBe(exec.id);
    expect(audit.before).toEqual({ role: "FREE_REP" });
    expect(audit.after).toEqual({ role: "PREMIUM_REP" });
  });

  it("stops a system admin promoting someone to executive and changes nothing", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const staff = await createUser(Role.STAFF);
    await expect(changeUserRole(admin, staff.id, Role.EXECUTIVE)).rejects.toThrow(ForbiddenError);
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).role).toBe(Role.STAFF);
    expect(await db.auditLog.count({ where: { entityId: staff.id } })).toBe(0);
  });

  it("stops staff from managing users even if the UI were bypassed", async () => {
    const staff = await createUser(Role.STAFF);
    const rep = await createUser(Role.FREE_REP);
    await expect(changeUserRole(staff, rep.id, Role.PREMIUM_REP)).rejects.toThrow(ForbiddenError);
  });

  it("stops an executive changing their own role", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    await expect(changeUserRole(exec, exec.id, Role.STAFF)).rejects.toThrow(/own role/);
  });

  it("requires a signed-in actor", async () => {
    const rep = await createUser(Role.FREE_REP);
    // @ts-expect-error simulating a missing session
    await expect(changeUserRole(null, rep.id, Role.STAFF)).rejects.toThrow(UnauthenticatedError);
  });
});

describe("setUserStatus", () => {
  it("suspends a user, removes their sessions, and audits it", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const rep = await createUser(Role.PREMIUM_REP);
    await db.session.create({
      data: {
        sessionToken: `tok-${rep.id}`,
        userId: rep.id,
        expires: new Date(Date.now() + 3600_000),
      },
    });

    await setUserStatus(admin, rep.id, "SUSPENDED");
    expect((await db.user.findUniqueOrThrow({ where: { id: rep.id } })).status).toBe("SUSPENDED");
    expect(await db.session.count({ where: { userId: rep.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: rep.id, action: "user.suspended" } })).toBe(
      1,
    );
  });

  it("stops a system admin suspending an executive", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const exec = await createUser(Role.EXECUTIVE);
    await expect(setUserStatus(admin, exec.id, "SUSPENDED")).rejects.toThrow(ForbiddenError);
  });
});

describe("inviteUser", () => {
  it("creates an invited user and audits it", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const user = await inviteUser(admin, {
      name: "New Rep",
      email: "NEW.rep@Example.test",
      role: Role.FREE_REP,
    });
    expect(user.email).toBe("new.rep@example.test");
    expect(user.status).toBe("INVITED");
    expect(await db.auditLog.count({ where: { entityId: user.id, action: "user.invited" } })).toBe(
      1,
    );
  });

  it("only lets an executive invite an executive", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await expect(
      inviteUser(admin, { name: "Boss", email: "boss@example.test", role: Role.EXECUTIVE }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects duplicates", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const existing = await createUser(Role.STAFF);
    await expect(
      inviteUser(exec, { name: "Dup", email: existing.email, role: Role.STAFF }),
    ).rejects.toThrow(/already exists/);
  });
});
