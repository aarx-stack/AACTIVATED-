import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Finance & Budget" };

export default async function Page() {
  await requirePagePermission("finance.view");
  return (
    <ComingSoon
      title={"Finance & Budget"}
      phase={4}
      description={"Revenue, expenses, AI spend and budget controls."}
      scope={[
        "Revenue vs expense and AI spend by department",
        "Budget meters with the 75% alert and approval rule",
        "Transactions and QuickBooks sync status",
      ]}
    />
  );
}
