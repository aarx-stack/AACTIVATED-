import { afterAll, describe, expect, it } from "vitest";
import { runModel } from "@/lib/ai";
import type { ModelAdapter } from "@/lib/ai/types";
import { db } from "./helpers";

afterAll(() => db.$disconnect());

describe("runModel logs every call to SpendEvent", () => {
  it("records provider, model, tokens and cost for the mock adapter", async () => {
    const result = await runModel({
      tier: "agent",
      purpose: "test: mock call",
      system: "You are a test.",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.provider).toBe("mock");

    const event = await db.spendEvent.findFirstOrThrow({
      where: { description: "test: mock call" },
    });
    expect(event.kind).toBe("AI_MODEL");
    expect(event.model).toBe("mock");
    expect(event.inputTokens).toBe(result.inputTokens);
    expect(event.outputTokens).toBe(result.outputTokens);
    expect(event.amountUsd.toNumber()).toBe(0);
  });

  it("prices real model usage from the pricing table", async () => {
    const fakeClaude: ModelAdapter = {
      provider: "anthropic",
      complete: async () => ({
        text: "ok",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        inputTokens: 10_000,
        outputTokens: 2_000,
        refused: false,
        stopReason: "end_turn",
      }),
    };
    const result = await runModel(
      {
        tier: "agent",
        purpose: "test: priced call",
        system: "",
        messages: [{ role: "user", content: "x" }],
      },
      { adapter: fakeClaude },
    );
    // 10k * $2/M + 2k * $10/M = $0.04
    expect(result.costUsd).toBeCloseTo(0.04);
    const event = await db.spendEvent.findFirstOrThrow({
      where: { description: "test: priced call" },
    });
    expect(event.amountUsd.toNumber()).toBeCloseTo(0.04);
  });
});
