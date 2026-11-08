import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { getAllTransactions } from "@/server/queries/finance";
import { TransactionsTable } from "@/components/finance/transactions-table";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  await requirePagePermission("finance.view");
  const rows = await getAllTransactions(200);
  return (
    <>
      <Link
        href="/finance"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Finance & Budget
      </Link>
      <PageHeader
        title="Transactions"
        description="The latest 200 transactions synced from QuickBooks (read-only)."
      />
      <Card className="p-5">
        <TransactionsTable rows={rows} />
      </Card>
    </>
  );
}
