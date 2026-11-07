"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { signIn } from "@/server/auth/config";

export interface LoginState {
  error?: string;
}

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const user = await db.user.findUnique({
    where: { email: parsed.data },
    select: { status: true },
  });
  // Same response whether or not the account exists, so emails cannot be enumerated.
  if (!user || user.status === "SUSPENDED") redirect("/login/check-email");

  // redirect: false sends the email without Auth.js's own redirect, so every
  // outcome lands on the same check-email page.
  await signIn("nodemailer", { email: parsed.data, redirectTo: "/", redirect: false });
  redirect("/login/check-email");
}

export async function demoSignIn(formData: FormData) {
  if (!getEnv().DEMO_LOGIN_ENABLED) redirect("/login");
  const email = z.string().email().parse(formData.get("email"));
  await signIn("demo", { email, redirectTo: "/" });
}
