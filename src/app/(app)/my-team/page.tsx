import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

export const metadata: Metadata = { title: "My AI Team" };

export default async function Page() {
  const user = await requireUser();
  if (!can(user.role, "rep_pod.full") && !can(user.role, "rep_pod.coach")) redirect("/forbidden");
  return (
    <ComingSoon
      title={"My AI Team"}
      phase={3}
      description={
        "Your private AI team: Content Creator, Social Media Manager, Lead Follow-up Specialist and Business Coach."
      }
      scope={[
        "Today's actions, progress and a weekly plan",
        "Free reps get the Business Coach",
        "Pods start from the current best agent templates",
      ]}
    />
  );
}
