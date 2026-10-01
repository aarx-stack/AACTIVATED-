import { notFound } from "next/navigation";
import { updateCaseAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CaseFields } from "@/components/fields";
import { Card, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

export default async function EditCasePage(props: PageProps<"/cases/[id]/edit">) {
  const { id } = await props.params;
  const ctx = await requireOwner();
  if (!uuid.safeParse(id).success) notFound();
  const kase = await ctx.store.get("cases", id);
  if (!kase) notFound();
  const client = await ctx.store.get("clients", kase.client_id);
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={client?.full_name} title={`Edit case`} />
      <Card lit>
        <ActionForm action={updateCaseAction} className="space-y-5">
          <input type="hidden" name="id" value={kase.id} />
          <CaseFields kase={kase} />
          <SubmitButton pendingLabel="Saving…">Save case</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
