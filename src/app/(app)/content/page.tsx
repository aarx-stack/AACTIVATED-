import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Content Studio" };

export default async function Page() {
  await requirePagePermission("content_studio.view");
  return (
    <ComingSoon
      title={"Content Studio"}
      phase={3}
      description={"Monthly calendar of posts by channel with an AI caption editor."}
      scope={[
        "Facebook, Instagram, TikTok and YouTube",
        "Draft, In Review, Approved and Scheduled statuses",
        "Every post passes the compliance check before review",
      ]}
    />
  );
}
