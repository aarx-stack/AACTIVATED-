import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getCurrentUser, homePathFor } from "@/server/auth/session";
import { ROLE_LABELS, ROLE_ORDER } from "@/server/authz/permissions";
import { demoSignIn } from "./actions";
import { MagicLinkForm } from "./magic-link-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "That account cannot sign in. Ask an administrator for an invite.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  CredentialsSignin: "Demo sign-in failed for that user.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));

  const { error } = await searchParams;
  const demoEnabled = getEnv().DEMO_LOGIN_ENABLED;
  const demoUsers = demoEnabled
    ? await db.user.findMany({
        where: { status: { not: "SUSPENDED" } },
        select: { name: true, email: true, role: true, title: true },
      })
    : [];
  demoUsers.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle persist={false} />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-[0.22em]">AACTIVATED</p>
          <p className="text-sm font-medium tracking-[0.3em] text-primary">AI BRAIN</p>
        </div>

        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>
              We will email you a one-time link. Accounts are invite-only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {error && (
              <p
                role="alert"
                className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {ERRORS[error] ?? "Sign-in failed. Please try again."}
              </p>
            )}
            <MagicLinkForm />

            {demoEnabled && (
              <>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <Badge tone="warning">Development only</Badge>
                  <Separator className="flex-1" />
                </div>
                <div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Sign in as a seeded demo user:
                  </p>
                  <ul className="flex flex-col gap-2" aria-label="Demo users">
                    {demoUsers.map((u) => (
                      <li key={u.email}>
                        <form action={demoSignIn}>
                          <input type="hidden" name="email" value={u.email} />
                          <button
                            type="submit"
                            data-testid={`demo-login-${u.email}`}
                            className="flex w-full items-center justify-between gap-3 rounded-control border border-border bg-surface-solid px-3 py-2 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-hover"
                          >
                            <span>
                              <span className="block font-medium">{u.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {u.title ?? u.email}
                              </span>
                            </span>
                            <Badge tone={u.role === "EXECUTIVE" ? "info" : "neutral"}>
                              {ROLE_LABELS[u.role]}
                            </Badge>
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
