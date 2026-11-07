import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Prompt Generator" };

export default async function Page() {
  await requirePagePermission("prompts.use");
  return (
    <ComingSoon
      title={"Prompt Generator"}
      phase={4}
      description={"Chat with the Brain and manage the prompt template library."}
      scope={[
        "Template library with variables and version history",
        "Send a prompt to a specific agent",
      ]}
    />
  );
}
