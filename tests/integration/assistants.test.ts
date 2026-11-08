import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { assignToAssistant, getMyAssistant } from "@/server/agents/assistants";
import { markTaskDone, runPromptTask } from "@/server/agents/task-work";
import { ForbiddenError } from "@/server/authz/permissions";
import { assignableAgents } from "@/server/prompts/service";
import { getCommandCenterData } from "@/server/queries/command-center";
import { changeUserRole, inviteUser, setUserStatus } from "@/server/users/admin";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

const tag = () => Math.random().toString(36).slice(2, 8);

describe("personal assistants", () => {
  it("every invited company user gets one; reps do not; role and status changes follow", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const staff = await inviteUser(admin, {
      name: "Robin Staff",
      email: `robin-${tag()}@example.test`,
      role: Role.STAFF,
    });
    const rep = await inviteUser(admin, {
      name: "Rae Rep",
      email: `rae-${tag()}@example.test`,
      role: Role.FREE_REP,
    });
    const assistant = await db.agent.findFirstOrThrow({
      where: { kind: "PERSONAL", ownerId: staff.id },
    });
    expect(assistant).toMatchObject({
      title: "Personal Assistant",
      name: "Robin's Aide",
      status: "ACTIVE",
    });
    expect(await db.agent.count({ where: { kind: "PERSONAL", ownerId: rep.id } })).toBe(0);

    await db.user.update({ where: { id: staff.id }, data: { status: "ACTIVE" } });
    await changeUserRole(admin, staff.id, Role.PREMIUM_REP);
    expect((await db.agent.findUniqueOrThrow({ where: { id: assistant.id } })).status).toBe(
      "PAUSED",
    );
    await changeUserRole(admin, staff.id, Role.STAFF);
    expect((await db.agent.findUniqueOrThrow({ where: { id: assistant.id } })).status).toBe(
      "ACTIVE",
    );
    await setUserStatus(admin, staff.id, "SUSPENDED");
    expect((await db.agent.findUniqueOrThrow({ where: { id: assistant.id } })).status).toBe(
      "PAUSED",
    );
    await setUserStatus(admin, staff.id, "ACTIVE");
    expect((await db.agent.findUniqueOrThrow({ where: { id: assistant.id } })).status).toBe(
      "ACTIVE",
    );
    expect(await db.agent.count({ where: { kind: "PERSONAL", ownerId: staff.id } })).toBe(1);
  });

  it("only the owner gives it work and accepts its drafts; its activity stays private", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const exec = await createUser(Role.EXECUTIVE);
    const invited = await inviteUser(admin, {
      name: "Sky Staff",
      email: `sky-${tag()}@example.test`,
      role: Role.STAFF,
    });
    const owner = await db.user.update({ where: { id: invited.id }, data: { status: "ACTIVE" } });
    const other = await createUser(Role.STAFF);
    const mine = (await getMyAssistant(owner))!;
    expect(mine).toBeTruthy();

    await expect(
      assignToAssistant(other, {
        agentId: mine.id,
        title: "Not mine",
        instructions: "Try to use someone else's assistant.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const secret = `Draft the board memo ${tag()}`;
    const task = await assignToAssistant(owner, {
      agentId: mine.id,
      title: secret,
      instructions: "Summarize the three decisions we need this week.",
    });
    expect((await runPromptTask(task.id)).status).toBe("done");

    await expect(markTaskDone(other, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markTaskDone(exec, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    await markTaskDone(owner, task.id);

    const feed = await getCommandCenterData(Role.EXECUTIVE);
    expect(feed.activity.some((a) => a.message.includes(secret))).toBe(false);

    const ownAgents = await assignableAgents(owner);
    expect(ownAgents.some((a) => a.id === mine.id)).toBe(true);
    expect((await assignableAgents(other)).some((a) => a.id === mine.id)).toBe(false);
  });
});
