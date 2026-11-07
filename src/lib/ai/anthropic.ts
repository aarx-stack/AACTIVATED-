import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, ModelAdapter } from "./types";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  models: { brain: string; agent: string };
}

/**
 * Claude adapter. Only constructed when AI_PROVIDER=anthropic.
 * - Thinking is adaptive (always on for current models); depth is set with `effort`.
 * - Server-side refusal fallbacks are on ("default" routing), so a policy decline is retried
 *   on a suitable model inside the same call. A remaining refusal is surfaced as `refused`.
 */
export class AnthropicModelAdapter implements ModelAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicAdapterOptions) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = this.options.models[request.tier];
    const response = await this.client.beta.messages.create({
      model,
      max_tokens: request.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: request.effort ?? (request.tier === "brain" ? "high" : "medium") },
      system: request.system,
      messages: request.messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      text,
      provider: "anthropic",
      model: response.model,
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      refused: response.stop_reason === "refusal",
      stopReason: response.stop_reason,
    };
  }
}
