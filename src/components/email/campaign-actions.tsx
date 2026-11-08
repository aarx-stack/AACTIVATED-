"use client";

import { sendCampaignAction, submitCampaignAction } from "@/app/(app)/content/email/actions";
import { ActionForm } from "@/components/forms/action-form";

export function SubmitCampaignButton({ id }: { id: string }) {
  return (
    <ActionForm
      action={submitCampaignAction}
      submitLabel="Send for approval"
      pendingLabel="Checking and submitting…"
      testId="submit-campaign"
    >
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}

export function SendCampaignButton({ id, estimate }: { id: string; estimate: number | null }) {
  return (
    <ActionForm
      action={sendCampaignAction}
      submitLabel={`Send now${estimate != null ? ` to about ${estimate}` : ""}`}
      pendingLabel="Sending…"
      testId="send-campaign"
    >
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
