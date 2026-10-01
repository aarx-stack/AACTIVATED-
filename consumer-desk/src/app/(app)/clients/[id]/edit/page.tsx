import { notFound } from "next/navigation";
import { updateClientAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientFields } from "@/components/fields";
import { Card, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

export default async function EditClientPage(props: PageProps<"/clients/[id]/edit">) {
  const { id } = await props.params;
  const ctx = await requireOwner();
  if (!uuid.safeParse(id).success) notFound();
  const client = await ctx.store.get("clients", id);
  if (!client) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${client.full_name}`} />
      <Card lit>
        <ActionForm action={updateClientAction} className="space-y-5">
          <input type="hidden" name="id" value={client.id} />
          <ClientFields client={client} />
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
