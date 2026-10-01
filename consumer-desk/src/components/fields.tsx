import type { Address, CaseRow, ClientRow } from "@/server/types";
import { Field } from "./ui";

export function AddressFields({
  prefix,
  defaults = {},
  nameLabel = "Name",
  requireAll = false,
}: {
  prefix: string;
  defaults?: Address;
  nameLabel?: string;
  requireAll?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <Field label={nameLabel} className="sm:col-span-6">
        <input className="input" name={`${prefix}_name`} defaultValue={defaults.name ?? ""} required={requireAll} autoComplete="off" />
      </Field>
      <Field label="Street address" className="sm:col-span-4">
        <input className="input" name={`${prefix}_line1`} defaultValue={defaults.line1 ?? ""} required={requireAll} autoComplete="off" />
      </Field>
      <Field label="Apt / suite / attention" className="sm:col-span-2">
        <input className="input" name={`${prefix}_line2`} defaultValue={defaults.line2 ?? ""} autoComplete="off" />
      </Field>
      <Field label="City" className="sm:col-span-3">
        <input className="input" name={`${prefix}_city`} defaultValue={defaults.city ?? ""} required={requireAll} autoComplete="off" />
      </Field>
      <Field label="State" className="sm:col-span-1">
        <input className="input" name={`${prefix}_state`} defaultValue={defaults.state ?? ""} maxLength={50} required={requireAll} autoComplete="off" />
      </Field>
      <Field label="ZIP" className="sm:col-span-2">
        <input className="input" name={`${prefix}_postal_code`} defaultValue={defaults.postal_code ?? ""} maxLength={20} required={requireAll} autoComplete="off" />
      </Field>
      <input type="hidden" name={`${prefix}_country`} value={defaults.country || "US"} />
    </div>
  );
}

export function ClientFields({ client }: { client?: ClientRow }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="Full name *" className="sm:col-span-6">
        <input className="input" name="full_name" defaultValue={client?.full_name ?? ""} required maxLength={200} />
      </Field>
      <Field label="Email" className="sm:col-span-3">
        <input className="input" type="email" name="email" defaultValue={client?.email ?? ""} />
      </Field>
      <Field label="Phone" className="sm:col-span-3">
        <input className="input" type="tel" name="phone" defaultValue={client?.phone ?? ""} />
      </Field>
      <Field label="Street address" className="sm:col-span-4">
        <input className="input" name="address_line1" defaultValue={client?.address_line1 ?? ""} />
      </Field>
      <Field label="Apartment / suite" className="sm:col-span-2">
        <input className="input" name="address_line2" defaultValue={client?.address_line2 ?? ""} />
      </Field>
      <Field label="City" className="sm:col-span-3">
        <input className="input" name="city" defaultValue={client?.city ?? ""} />
      </Field>
      <Field label="State" className="sm:col-span-1">
        <input className="input" name="state" defaultValue={client?.state ?? ""} />
      </Field>
      <Field label="ZIP" className="sm:col-span-2">
        <input className="input" name="postal_code" defaultValue={client?.postal_code ?? ""} />
      </Field>
      <input type="hidden" name="country" value={client?.country ?? "US"} />
      <Field label="Preferred contact method" className="sm:col-span-3">
        <select className="select" name="preferred_contact" defaultValue={client?.preferred_contact ?? "email"}>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="mail">Mail</option>
          <option value="none">None</option>
        </select>
      </Field>
      <Field label="Tags" hint="Comma separated" className="sm:col-span-3">
        <input className="input" name="tags" defaultValue={client?.tags.join(", ") ?? ""} />
      </Field>
      <Field
        label="Notes"
        hint="Do not store full SSNs, bank logins, bureau passwords or full account numbers."
        className="sm:col-span-6"
      >
        <textarea className="textarea" name="notes" defaultValue={client?.notes ?? ""} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-soft sm:col-span-6">
        <input type="checkbox" name="is_test_record" defaultChecked={client?.is_test_record ?? false} className="mt-1" />
        <span>
          This is a <strong>TEST RECORD</strong> (my own details, used to test the workflow — not a client).
        </span>
      </label>
    </div>
  );
}

export function CaseFields({ kase }: { kase?: CaseRow }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="Case title *" className="sm:col-span-4">
        <input className="input" name="title" defaultValue={kase?.title ?? ""} required maxLength={200} />
      </Field>
      <Field label="Category" className="sm:col-span-2">
        <input className="input" name="category" defaultValue={kase?.category ?? "general"} list="case-categories" />
        <datalist id="case-categories">
          <option value="general" />
          <option value="billing" />
          <option value="correspondence" />
          <option value="information_request" />
          <option value="credit_report_question" />
          <option value="collections_correspondence" />
        </datalist>
      </Field>
      <Field label="Organization / recipient" className="sm:col-span-4">
        <input className="input" name="organization" defaultValue={kase?.organization ?? ""} />
      </Field>
      <Field label="Account reference (last 4 only)" className="sm:col-span-2" hint="Exactly four digits, or blank.">
        <input className="input" name="account_last4" defaultValue={kase?.account_last4 ?? ""} inputMode="numeric" pattern="\d{4}" maxLength={4} />
      </Field>
      <Field label="Description (in your words)" className="sm:col-span-6">
        <textarea className="textarea" name="description" defaultValue={kase?.description ?? ""} />
      </Field>
      <Field label="Case status" className="sm:col-span-2">
        <select className="select" name="status" defaultValue={kase?.status ?? "open"}>
          <option value="open">Open</option>
          <option value="waiting">Waiting</option>
          <option value="action_required">Action required</option>
          <option value="closed">Closed</option>
        </select>
      </Field>
      <Field label="Next action" className="sm:col-span-2">
        <input className="input" name="next_action" defaultValue={kase?.next_action ?? ""} />
      </Field>
      <Field label="Reminder date" className="sm:col-span-2" hint="Your own reminder — not a legal deadline.">
        <input className="input" type="date" name="reminder_date" defaultValue={kase?.reminder_date ?? ""} />
      </Field>
      <fieldset className="rounded-xl border border-white/10 p-3 sm:col-span-6">
        <legend className="px-1 text-xs font-semibold text-soft">Authorization (when working on another person&apos;s behalf)</legend>
        <div className="flex flex-col gap-2 text-sm text-soft">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="acting_for_another" defaultChecked={kase?.acting_for_another} /> I am working on another
            person&apos;s behalf for this case
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="authorization_on_file" defaultChecked={kase?.authorization_on_file} /> Signed authorization is
            on file (upload it under Documents → Authorization)
          </label>
          <input className="input" name="authorization_notes" placeholder="Authorization notes (date signed, scope…)" defaultValue={kase?.authorization_notes ?? ""} />
        </div>
      </fieldset>
      <Field label="Case outcome (your notes)" className="sm:col-span-6" hint="Recorded separately from delivery and responses.">
        <textarea className="textarea !min-h-[80px]" name="outcome" defaultValue={kase?.outcome ?? ""} />
      </Field>
    </div>
  );
}
