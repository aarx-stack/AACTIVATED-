import { createClientAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientFields } from "@/components/fields";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const ctx = await requireOwner();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add client" description="Only collect what you need. Full SSNs, bank logins, bureau passwords and full account numbers are not accepted." />
      {ctx.isDemo && (
        <div className="mb-4">
          <Notice tone="warn">Demo mode: use fictional details only. Demo records are lost when the server restarts.</Notice>
        </div>
      )}
      <Card lit>
        <ActionForm action={createClientAction} className="space-y-5" testId="client-form">
          <ClientFields />
          <SubmitButton pendingLabel="Saving…" testId="client-submit">Save client</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
