import { describe, expect, it } from "vitest";
import {
  knowledgeSummarySkill,
  promptChatSkill,
  promptChatOutput,
  summaryOutput,
  templateVariables,
} from "@/server/agents/skills";
import { renderTemplate } from "@/server/prompts/service";
import { shortDepartment } from "@/server/queries/finance";

describe("templateVariables", () => {
  it("finds {{variables}} once each, lower-cased, in order", () => {
    expect(templateVariables("Hi {{Name}}, about {{topic}} and {{ name }} again")).toEqual([
      "name",
      "topic",
    ]);
  });
  it("ignores malformed placeholders", () => {
    expect(templateVariables("{{}} {{ 1bad }} {single}")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("fills every variable", () => {
    expect(
      renderTemplate("Write about {{topic}} for {{ audience }}.", {
        topic: "sleep",
        audience: "reps",
      }),
    ).toBe("Write about sleep for reps.");
  });
  it("refuses when a variable is missing or blank, naming it", () => {
    expect(() => renderTemplate("{{a}} {{b}}", { a: "x", b: "  " })).toThrow("Fill in {{b}}");
  });
});

describe("knowledge summary skill (mock)", () => {
  it("summarizes from the document only, with bullet points as takeaways", () => {
    const out = knowledgeSummarySkill.mock({
      title: "Rules",
      body: "First sentence here. Second one. Third one. Fourth.\n- Point A is here.\n- Point B is here.",
    });
    expect(summaryOutput.parse(out)).toEqual(out);
    expect(out.summary).toBe("First sentence here. Second one. Third one.");
    expect(out.keyPoints).toEqual(["Point A is here.", "Point B is here."]);
  });
});

describe("prompt chat skill (mock)", () => {
  it("writes a new template with variables when asked", () => {
    const out = promptChatSkill.mock({
      message: "Create a prompt for a launch email",
      history: [],
    });
    expect(promptChatOutput.parse(out)).toEqual(out);
    expect(out.template?.name).toBe("Launch Email");
    expect(templateVariables(out.template!.body)).toContain("call_to_action");
    expect(out.template!.body).toMatch(/No health or medical claims/);
  });
  it("updates the template on screen when asked to improve it", () => {
    const out = promptChatSkill.mock({
      message: "Add guidance on length",
      history: [],
      template: { name: "Post", body: "Write about {{topic}}.", variables: ["topic"] },
    });
    expect(out.template?.name).toBe("Post");
    expect(out.template?.body).toContain("{{length}}");
  });
  it("answers without a template for small talk", () => {
    expect(promptChatSkill.mock({ message: "hello", history: [] }).template).toBeNull();
  });
});

describe("shortDepartment", () => {
  it("shortens department names to fit under a chart bar", () => {
    expect(shortDepartment("Sales & Affiliate Success")).toBe("Sales");
    expect(shortDepartment("Company (Brain)")).toBe("Brain");
    expect(shortDepartment("Social Media")).toBe("Social");
    expect(shortDepartment("Human Resources")).toBe("HR");
    expect(shortDepartment("Marketing")).toBe("Marketing");
  });
});
