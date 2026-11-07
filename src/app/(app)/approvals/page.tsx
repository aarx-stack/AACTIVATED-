import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Approval & Compliance Queue" };

export default async function Page() {
  await requirePagePermission("approvals.view");
  return (
    <ComingSoon
      title={"Approval & Compliance Queue"}
      phase={2}
      description={"Every outbound item waits here for a human decision."}
      scope={[
        "Pending posts, emails and spend requests with compliance result and risk level",
        "Agent reasoning and sources shown above every decision",
        "Approve, edit or reject, with a full audit trail",
      ]}
    />
  );
}
