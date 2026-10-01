import { uploadDocumentAction } from "@/app/actions/records";
import { DOCUMENT_CATEGORY } from "@/lib/labels";
import { ActionForm, SubmitButton } from "./action-form";
import { ClientCasePicker, type PickerCase, type PickerClient } from "./pickers";
import { Field } from "./ui";

export function UploadForm({
  clients,
  cases,
  isDemo,
  defaultClientId,
  defaultCaseId,
  returnTo,
  defaultCategory = "supporting_evidence",
}: {
  clients: PickerClient[];
  cases: PickerCase[];
  isDemo: boolean;
  defaultClientId?: string;
  defaultCaseId?: string;
  returnTo?: string;
  defaultCategory?: string;
}) {
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-4" testId="upload-form">
      <ClientCasePicker clients={clients} cases={cases} defaultClientId={defaultClientId} defaultCaseId={defaultCaseId} caseRequired={false} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category *">
          <select className="select" name="category" defaultValue={defaultCategory}>
            {Object.entries(DOCUMENT_CATEGORY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <input className="input" name="description" maxLength={500} />
        </Field>
      </div>
      <Field label="File (PDF, PNG or JPEG, up to 10 MB) *" hint="Type is verified on the server from the file contents. Encrypted PDFs are rejected.">
        <input className="input" type="file" name="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" required data-testid="upload-file" />
      </Field>
      {isDemo && (
        <label className="notice notice-warn flex items-start gap-2">
          <input type="checkbox" name="demo_fictional_ack" required className="mt-1" data-testid="demo-ack" />
          <span>
            Demo mode: I confirm this file is <strong>fictional test content</strong> and contains no real person&apos;s
            information or identity documents. (Demo files are held in memory and lost on restart.)
          </span>
        </label>
      )}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <SubmitButton pendingLabel="Uploading…" testId="upload-submit">
        Upload document
      </SubmitButton>
    </ActionForm>
  );
}
