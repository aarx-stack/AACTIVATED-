import { notFound } from "next/navigation";
import { createCaseAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CaseFields } from "@/components/fields";
import { Card, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

export default async function NewCasePage(props: PageProps<"/clients/[id]/cases/new">) {
  const { id } = await props.params;
  const ctx = await requireOwner();
  if (!uuid.safeParse(id).success) notFound();
  const client = await ctx.store.get("clients", id);
  if (!client) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={client.full_name} title="Create case" description="Describe the matter in your own words. The app never generates dispute grounds or legal conclusions." />
      <Card lit>
        <ActionForm action={createCaseAction} className="space-y-5" testId="case-form">
          <input type="hidden" name="client_id" value={client.id} />
          <CaseFields />
          <SubmitButton pendingLabel="Saving…" testId="case-submit">Save case</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
