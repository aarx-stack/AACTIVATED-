"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { signIn } from "@/server/auth/config";
import { consume, limitKey, SIGN_IN_LIMITS } from "@/server/security/rate-limit";

/** The client's address as reported by the hosting proxy (first hop of X-Forwarded-For). */
async function clientAddress() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export interface LoginState {
  error?: string;
}

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  // Counted before the account lookup, so the answer is the same for every address.
  const { allowed } = await consume(
    limitKey("signin-ip", await clientAddress()),
    SIGN_IN_LIMITS.perIp,
  );
  if (!allowed) return { error: "Too many sign-in requests. Wait 15 minutes and try again." };

  const user = await db.user.findUnique({
    where: { email: parsed.data },
    select: { status: true },
  });
  // Same response whether or not the account exists, so emails cannot be enumerated.
  if (!user || user.status === "SUSPENDED") redirect("/login/check-email");

  // redirect: false sends the email without Auth.js's own redirect, so every
  // outcome lands on the same check-email page.
  try {
    await signIn("nodemailer", { email: parsed.data, redirectTo: "/", redirect: false });
  } catch (error) {
    // A refused request (for example, too many emails to this address) looks the same as a
    // sent one, so the form never reveals anything about the account.
    if (!(error instanceof AuthError)) throw error;
  }
  redirect("/login/check-email");
}

export async function demoSignIn(formData: FormData) {
  if (!getEnv().DEMO_LOGIN_ENABLED) redirect("/login");
  const email = z.string().email().parse(formData.get("email"));
  await signIn("demo", { email, redirectTo: "/" });
}
