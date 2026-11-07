import type { CompletionRequest, CompletionResult, ModelAdapter } from "./types";

/** Rough token estimate (~4 chars/token) so mock calls still produce realistic SpendEvents. */
export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Deterministic, offline, free. Used by default and in every test.
 * Echoes the question and surfaces the context lines the caller supplied (lines starting with "- ").
 */
export class MockModelAdapter implements ModelAdapter {
  readonly provider = "mock" as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const question = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const facts = request.system
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .slice(0, 6);

    const text = [
      `Mock response (AI_PROVIDER=mock). You asked: "${question.trim()}"`,
      facts.length ? "Here is what I can see right now:" : "",
      ...facts,
      "Switch AI_PROVIDER to anthropic for a full answer from Claude.",
    ]
      .filter(Boolean)
      .join("\n");

    const input = request.system + request.messages.map((m) => m.content).join("\n");
    return {
      text,
      provider: "mock",
      model: "mock",
      inputTokens: estimateTokens(input),
      outputTokens: estimateTokens(text),
      refused: false,
      stopReason: "end_turn",
    };
  }
}
