/**
 * The single server-side entry point for model calls.
 * Every call is logged to SpendEvent (agent, model, tokens, cost).
 */
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { SpendKind } from "@/generated/prisma/enums";
import { db, type DbClient } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AnthropicModelAdapter } from "./anthropic";
import { MockModelAdapter } from "./mock";
import { costUsd } from "./pricing";
import type { CompletionRequest, CompletionResult, ModelAdapter } from "./types";

export type { CompletionRequest, CompletionResult, ModelAdapter } from "./types";

let adapter: ModelAdapter | undefined;

export function getModelAdapter(): ModelAdapter {
  if (adapter) return adapter;
  const env = getEnv();
  adapter =
    env.AI_PROVIDER === "anthropic"
      ? new AnthropicModelAdapter({
          apiKey: env.ANTHROPIC_API_KEY || undefined,
          models: { brain: env.ANTHROPIC_MODEL_BRAIN, agent: env.ANTHROPIC_MODEL_AGENT },
        })
      : new MockModelAdapter();
  return adapter;
}

/** Test hook. */
export function setModelAdapter(next: ModelAdapter | undefined) {
  adapter = next;
}

export interface RunModelInput extends CompletionRequest {
  purpose: string;
  agentId?: string | null;
  departmentId?: string | null;
}

export async function runModel(
  input: RunModelInput,
  options: { client?: DbClient; adapter?: ModelAdapter } = {},
): Promise<CompletionResult & { costUsd: number }> {
  const client = options.client ?? db;
  const result = await (options.adapter ?? getModelAdapter()).complete(input);
  const cost = costUsd(result.model, result.inputTokens, result.outputTokens);

  await client.spendEvent.create({
    data: {
      kind: SpendKind.AI_MODEL,
      description: input.purpose,
      amountUsd: new Prisma.Decimal(cost.toFixed(6)),
      agentId: input.agentId ?? null,
      departmentId: input.departmentId ?? null,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });

  return { ...result, costUsd: cost };
}
