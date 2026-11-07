/** Provider-neutral contract for every model call in the app. */
export type ModelTier = "brain" | "agent";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  tier: ModelTier;
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
  effort?: Effort;
  /** Constrain the reply to this JSON schema (structured output). */
  jsonSchema?: Record<string, unknown>;
  /**
   * What the mock adapter returns for this request (serialized as JSON).
   * Lets each agent skill define a deterministic offline answer. Ignored by real providers.
   */
  mockOutput?: unknown;
}

export interface CompletionResult {
  text: string;
  provider: "mock" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the model declined (stop_reason "refusal") even after fallbacks. */
  refused: boolean;
  stopReason: string | null;
}

export interface ModelAdapter {
  readonly provider: CompletionResult["provider"];
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
