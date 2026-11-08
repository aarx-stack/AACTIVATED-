"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { signIn } from "@/server/auth/config";

export interface LoginState {
  error?: string;
}

/**
 * Requests a sign-in link. The rules (invite-only, rate limits, same answer for every address)
 * live in the Auth.js signIn callback, so they also apply to Auth.js's own endpoint.
 */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  let target = "";
  try {
    // redirect: false returns where Auth.js would send the browser instead of redirecting.
    target = String(
      (await signIn("nodemailer", { email: parsed.data, redirectTo: "/", redirect: false })) ?? "",
    );
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
  }
  if (target.includes("error=RateLimited")) {
    return { error: "Too many sign-in requests. Wait 15 minutes and try again." };
  }
  redirect("/login/check-email");
}

export async function demoSignIn(formData: FormData) {
  if (!getEnv().DEMO_LOGIN_ENABLED) redirect("/login");
  const email = z.string().email().parse(formData.get("email"));
  await signIn("demo", { email, redirectTo: "/" });
}
