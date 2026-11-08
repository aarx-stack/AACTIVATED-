import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { decideApproval } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  addSection,
  contentHash,
  createPublication,
  exportModel,
  getPublication,
  listPublications,
  moveSection,
  PublicationStateError,
  submitPublication,
  updateSection,
  writeSectionWithAI,
} from "@/server/publishing/service";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

const base = {
  audience: "new members",
  description: "A short guide to building a steady weekly recovery routine.",
};

describe("publishing", () => {
  it("outline with AI, write every chapter, executive approval, final exports", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const p = await createPublication(staff, {
      ...base,
      title: "Recovery Routine Guide",
      kind: "EBOOK",
      outlineWithAI: true,
      sectionCount: 4,
    });
    let view = await getPublication(staff, p.id);
    expect(view.publication.sections.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(view.publication.sections[0]!.summary.length).toBeGreaterThan(10);

    await expect(submitPublication(staff, p.id)).rejects.toThrow(/Write every chapter first/);

    for (const s of view.publication.sections) await writeSectionWithAI(staff, s.id);
    view = await getPublication(staff, p.id);
    expect(
      view.publication.sections.every((s) => s.writtenBy?.includes("Book & E-book Author")),
    ).toBe(true);
    expect(view.words).toBeGreaterThan(200);
    expect((await exportModel(staff, p.id)).final).toBe(false);

    const request = await submitPublication(staff, p.id);
    expect(request.type).toBe("PUBLICATION");
    expect(request.requiredRole).toBe("EXECUTIVE");
    expect((await getPublication(staff, p.id)).publication.status).toBe("IN_REVIEW");
    // Locked while an executive decides.
    await expect(
      updateSection(staff, view.publication.sections[0]!.id, { title: "Changed", body: "x" }),
    ).rejects.toBeInstanceOf(PublicationStateError);
    const otherStaff = await createUser(Role.STAFF);
    await expect(
      decideApproval(otherStaff, request.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await decideApproval(exec, request.id, { decision: "APPROVE", note: "Ready for the library." });
    view = await getPublication(staff, p.id);
    expect(view.publication.status).toBe("APPROVED");
    expect(view.publication.approvedHash).toBe(contentHash(view.publication));
    expect(view.approvedAndUnchanged).toBe(true);
    expect((await exportModel(staff, p.id)).final).toBe(true);

    // Any edit after approval sends it back to drafting; exports are DRAFT again.
    const first = view.publication.sections[0]!;
    await updateSection(staff, first.id, {
      title: first.title,
      summary: first.summary,
      body: `${first.body}\n\nOne more line.`,
    });
    view = await getPublication(staff, p.id);
    expect(view.publication.status).toBe("DRAFTING");
    expect(view.changedSinceApproval).toBe(true);
    expect((await exportModel(staff, p.id)).final).toBe(false);
  });

  it("a rejection allows a revised resubmission; risky text needs an executive with findings", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const p = await createPublication(staff, { ...base, title: "Bold claims", kind: "ARTICLE" });
    const s = await addSection(staff, p.id, "The routine");
    await updateSection(staff, s.id, {
      title: "The routine",
      body: "This routine cures soreness for everyone who tries it, every single time, guaranteed for all readers. Follow it for one week and see the results for yourself.",
    });
    const request = await submitPublication(staff, p.id);
    const check = await db.complianceCheck.findFirstOrThrow({
      where: { approvalRequestId: request.id },
    });
    expect(check.outcome).toBe("FAIL");
    await decideApproval(exec, request.id, { decision: "REJECT", note: "Remove the claim." });
    expect((await getPublication(staff, p.id)).publication.status).toBe("REJECTED");

    await updateSection(staff, s.id, {
      title: "The routine",
      body: "A steady routine helps many people feel more organized. Start small, keep notes for a week, and then adjust the plan to fit your schedule and your goals.",
    });
    const again = await submitPublication(staff, p.id);
    expect(again.id).not.toBe(request.id);
  });

  it("parts can be reordered, and publishing is for company staff only", async () => {
    const staff = await createUser(Role.STAFF);
    const p = await createPublication(staff, { ...base, title: "Order test", kind: "BOOK" });
    const a = await addSection(staff, p.id, "First");
    const b = await addSection(staff, p.id, "Second");
    await moveSection(staff, b.id, "up");
    const titles = (await getPublication(staff, p.id)).publication.sections.map((s) => s.title);
    expect(titles).toEqual(["Second", "First"]);
    expect(a.id).toBeTruthy();

    for (const role of [Role.PREMIUM_REP, Role.FREE_REP, Role.SYSTEM_ADMIN]) {
      const user = await createUser(role);
      await expect(listPublications(user)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPublication(user, p.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
