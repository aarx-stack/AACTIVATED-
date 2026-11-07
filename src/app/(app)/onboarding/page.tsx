import { Bot, CalendarCheck2, GraduationCap, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/reps/onboarding-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth/session";
import { isRep } from "@/server/reps/onboarding";
import { POD_ROLES, REP_ROLE_LABEL } from "@/server/reps/pods";

export const metadata: Metadata = { title: "Welcome" };

const ICONS = {
  CONTENT_CREATOR: Bot,
  SOCIAL_MEDIA_MANAGER: CalendarCheck2,
  LEAD_FOLLOWUP: MessagesSquare,
  BUSINESS_COACH: GraduationCap,
} as const;

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!isRep(user.role)) redirect("/forbidden");
  const done = await db.user.findUnique({ where: { id: user.id }, select: { onboardedAt: true } });
  if (done?.onboardedAt) redirect("/my-team");
  const roles = POD_ROLES[user.role];
  const premium = user.role === "PREMIUM_REP";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Welcome"
        title={`Welcome, ${user.name?.split(" ")[0] ?? "there"}`}
        description="Two quick agreements and your private AI team is ready. It starts from the company's current best playbooks."
      />
      <Card className="mb-4">
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Your AI team</CardTitle>
          <CardDescription>
            {premium
              ? "Premium includes four agents. They draft and plan; you and the company approve anything that goes out."
              : "Free includes your Business Coach and your earnings view. Upgrade to Premium for the full team."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {roles.map((r) => {
              const Icon = ICONS[r];
              return (
                <li
                  key={r}
                  className="flex items-center gap-3 rounded-control border border-border p-3 text-sm"
                >
                  <span className="flex size-9 items-center justify-center rounded-control bg-info-soft text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {REP_ROLE_LABEL[r]}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Agreements</CardTitle>
        </CardHeader>
        <CardContent>
          <OnboardingForm premium={premium} />
        </CardContent>
      </Card>
    </div>
  );
}
