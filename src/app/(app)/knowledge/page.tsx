import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Knowledge Library" };

export default async function Page() {
  await requirePagePermission("knowledge.view");
  return (
    <ComingSoon
      title={"Knowledge Library"}
      phase={4}
      description={"Searchable company documents with access tags."}
      scope={[
        "Policies, Training, Legal Research, Brand and Product Education",
        "Executive Only and All Staff access enforced on the server",
        "AI summary panel",
      ]}
    />
  );
}
