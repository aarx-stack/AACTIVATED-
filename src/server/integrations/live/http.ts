import { IntegrationUnavailableError } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * One HTTP call to an external system: timeout, JSON, and errors that never leak
 * credentials or raw response bodies into the UI. Any failure becomes
 * IntegrationUnavailableError, so callers degrade instead of crashing.
 */
export async function callJson<T>(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number },
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new IntegrationUnavailableError(
      timedOut ? `${service} did not respond in time.` : `${service} could not be reached.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationUnavailableError(
      `${service} refused the credentials (${response.status}).`,
      response.status,
    );
  }
  if (response.status === 429) {
    throw new IntegrationUnavailableError(
      `${service} is rate limiting requests. Try again shortly.`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new IntegrationUnavailableError(
      `${service} returned an error (${response.status}).`,
      response.status,
    );
  }
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some endpoints (e.g. Slack webhooks) answer with plain text.
    return { text } as T;
  }
}

/** Times an async call in milliseconds. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - start)];
}
