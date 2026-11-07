import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Development & Tokenization Map" };

export default async function Page() {
  await requirePagePermission("roadmap.view");
  return (
    <ComingSoon
      title={"Development & Tokenization Map"}
      phase={5}
      description={"Project roadmap from Idea to Launch."}
      scope={[
        "Idea, Build, Review and Launch columns",
        "Locked items show Pending Approval",
        "The tokenization platform cannot launch without executive approval",
      ]}
    />
  );
}
