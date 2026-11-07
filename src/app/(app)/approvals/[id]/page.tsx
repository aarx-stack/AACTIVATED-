import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { PageHeader } from "@/components/shell/page-header";
import { requirePagePermission } from "@/server/auth/session";
import { getApprovalDetail } from "@/server/queries/approvals";

export const metadata: Metadata = { title: "Review request" };

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("approvals.view");
  const { id } = await params;
  const detail = await getApprovalDetail(user.role, id);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/approvals"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Approval & Compliance Queue
      </Link>
      <PageHeader title="Review request" description={detail.request.summary} />
      <ApprovalPanel detail={detail} viewer={user} />
    </div>
  );
}
