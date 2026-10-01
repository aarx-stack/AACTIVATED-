import "server-only";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireOwner, type Ctx } from "./context";
import { log } from "./log";
import { rateLimit } from "./rate-limit";
import { UserError, toUserMessage } from "./services/errors";

export interface ActResult {
  redirectTo?: string;
  message?: string;
}

/**
 * Wraps every mutating server action: authenticates the owner on the server, rate-limits,
 * converts errors to safe messages, revalidates, then redirects if requested.
 */
export async function act(
  name: string,
  fn: (ctx: Ctx) => Promise<ActResult | void>,
  opts: { limit?: number } = {},
): Promise<ActionState> {
  const ctx = await requireOwner();
  if (!rateLimit(`action:${ctx.owner.id}:${name}`, opts.limit ?? 60, 60_000)) {
    return { status: "error", message: "Too many requests. Wait a minute and try again." };
  }
  let result: ActResult | void;
  try {
    result = await fn(ctx);
  } catch (err) {
    unstable_rethrow(err);
    if (!(err instanceof UserError)) log.warn("action failed", { operation: name, name: (err as Error)?.name });
    return { status: "error", message: toUserMessage(err) };
  }
  revalidatePath("/", "layout");
  if (result?.redirectTo) redirect(result.redirectTo);
  return { status: "success", message: result?.message ?? "Saved." };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function strOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key).trim();
  return v ? v : null;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export async function fileFrom(fd: FormData, key: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const v = fd.get(key);
  if (!v || typeof v === "string") return null;
  const file = v as File;
  if (!file.size) return null;
  return { filename: file.name || "upload", bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function address(fd: FormData, prefix: string) {
  return {
    name: str(fd, `${prefix}_name`),
    line1: str(fd, `${prefix}_line1`),
    line2: str(fd, `${prefix}_line2`),
    city: str(fd, `${prefix}_city`),
    state: str(fd, `${prefix}_state`),
    postal_code: str(fd, `${prefix}_postal_code`),
    country: str(fd, `${prefix}_country`) || "US",
  };
}
