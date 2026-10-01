import type { AppConfig, MailPolicy } from "../config";
import { LetterStreamProvider } from "./letterstream-provider";
import { MockMailProvider } from "./mock-provider";
import type { MailProvider } from "./types";

export type { MailProvider } from "./types";

/**
 * Chooses the provider implementation for the resolved policy. Returns null when the policy
 * allows no provider (misconfigured). Credentials are read from server env vars here and never
 * leave the server.
 */
export function providerFor(policy: MailPolicy, config: AppConfig, env = process.env): MailProvider | null {
  if (policy.provider === "mock") return new MockMailProvider();
  if (config.dataMode !== "supabase") return null;
  const mode = config.mailMode === "live" ? "live" : config.mailMode === "provider_test" ? "provider_test" : null;
  if (!mode) return null;
  const prefix = mode === "live" ? "LETTERSTREAM_LIVE" : "LETTERSTREAM_TEST";
  return new LetterStreamProvider(
    mode,
    {
      apiId: env[`${prefix}_API_ID`]?.trim() || undefined,
      apiKey: env[`${prefix}_API_KEY`]?.trim() || undefined,
      baseUrl: env[`${prefix}_BASE_URL`]?.trim() || undefined,
    },
    config.dataMode,
  );
}

/** Retries read-only calls with exponential backoff. Never use for paid submissions. */
export async function withReadRetry<T extends { kind: string; retryable?: boolean }>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 400 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
      if (!(last.kind === "error" && last.retryable)) return last;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
  }
  return last as T;
}
