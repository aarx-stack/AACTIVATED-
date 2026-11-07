/**
 * USD per 1M tokens (Anthropic first-party rates). Update when pricing changes.
 * Unknown models fall back to the most expensive known rate so spend is never under-reported.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  mock: { input: 0, output: 0 },
};

const MOST_EXPENSIVE = { input: 10, output: 50 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model] ?? MOST_EXPENSIVE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
