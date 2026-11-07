import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Rep Back Office" };

export default async function Page() {
  await requirePagePermission("back_office.view_own");
  return (
    <ComingSoon
      title={"Rep Back Office"}
      phase={3}
      description={"Earnings, commission plan progress, team growth and payouts."}
      scope={[
        "This month, pending and lifetime earnings",
        "Presenter status badge and commission plan progress",
        "Payout history",
      ]}
    />
  );
}
