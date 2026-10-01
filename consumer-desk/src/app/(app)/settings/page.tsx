import Link from "next/link";
import { resetDemoAction, saveProfileAction, saveSettingsAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AddressFields } from "@/components/fields";
import { Badge, Card, DefinitionList, Field, Notice, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getConnectionState } from "@/server/services/provider-health";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

const CHECKLIST = [
  ["Access controls", "Only your owner account exists in Supabase Auth; sign-ups are disabled; OWNER_EMAIL matches; the owner row exists in public.users. Test that a second account and an anonymous request see nothing."],
  ["MFA", "Enroll an authenticator app (Settings → Security) and set REQUIRE_MFA=true so the app refuses access without it."],
  ["Storage privacy", "The consumer-desk-private bucket is not public; files only download through the app after sign-in. Confirm in the Supabase dashboard."],
  ["Backups", "Enable Supabase backups (or point-in-time recovery) for the database, and back up the storage bucket separately. Test a restore."],
  ["Independent security review", "Have a qualified person review the deployment, policies and code before storing real client documents. This app has not been independently audited."],
  ["Upload limits", "Uploads are type/size/encryption checked but NOT virus-scanned. Only open files you trust."],
];

export default async function SettingsPage() {
  const ctx = await requireOwner();
  const settings = await getSettings(ctx);
  const conn = await getConnectionState(ctx);
  const c = ctx.config;

  return (
    <div>
      <PageHeader title="Settings" description="Workspace preferences, connection health and safety checklist. Secret values are never displayed." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Workspace" lit>
          <ActionForm action={saveSettingsAction} className="space-y-4">
            <Field label="Application name"><input className="input" name="app_name" defaultValue={settings.app_name} required maxLength={60} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Primary accent"><input className="input h-11 p-1" type="color" name="accent_primary" defaultValue={settings.accent_primary} /></Field>
              <Field label="Highlight"><input className="input h-11 p-1" type="color" name="accent_highlight" defaultValue={settings.accent_highlight} /></Field>
              <Field label="Violet accent"><input className="input h-11 p-1" type="color" name="accent_violet" defaultValue={settings.accent_violet} /></Field>
            </div>
            <Field label="Timezone (IANA)" hint="Used for dates, “today” and follow-ups.">
              <input className="input" name="timezone" defaultValue={settings.timezone} list="tz-list" required />
              <datalist id="tz-list">
                {["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu"].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <div>
              <p className="label">Default return address (used as the sender on new letters)</p>
              <AddressFields prefix="return" defaults={settings.return_address} nameLabel="Sender name" />
            </div>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card title="Owner profile">
            <DefinitionList items={[["Owner email", ctx.owner.email], ["Data mode", ctx.isDemo ? "Demo (fictional, in memory)" : "Connected (Supabase)"]]} />
            {!ctx.isDemo && (
              <ActionForm action={saveProfileAction} className="mt-4 flex gap-2">
                <input className="input" name="display_name" defaultValue={ctx.owner.displayName} aria-label="Display name" />
                <SubmitButton className="btn">Save</SubmitButton>
              </ActionForm>
            )}
            <Link href="/settings/security" className="btn btn-sm mt-4">Security &amp; MFA</Link>
          </Card>

          <Card title="Mailing mode & health">
            <DefinitionList
              items={[
                ["DATA_MODE", <code key="d">{c.dataMode}</code>],
                ["MAIL_MODE", <code key="m">{c.mailMode}</code>],
                ["LIVE_MAILING_ENABLED", <code key="l">{String(c.liveMailingEnabled)}</code>],
                ["Effective mode", ctx.policy.label],
                ["Submissions allowed", ctx.policy.canSubmit ? "Yes" : `No — ${ctx.policy.blockedReason}`],
                ["Provider", conn.descriptor?.displayName ?? "None"],
                ["Connection", <Badge key="c" tone={conn.label === "Verified" ? "green" : "amber"}>{conn.label}</Badge>],
                ["Last successful connection", formatDateTime(conn.lastSuccessfulConnection, ctx.timezone)],
                ["LetterStream test credentials", `${c.letterstream.test.apiIdPresent && c.letterstream.test.apiKeyPresent && c.letterstream.test.baseUrlPresent ? "Present" : "Not configured"} (values hidden)`],
                ["LetterStream live credentials", `${c.letterstream.live.apiIdPresent && c.letterstream.live.apiKeyPresent && c.letterstream.live.baseUrlPresent ? "Present" : "Not configured"} (values hidden)`],
                ["Automatic status sync", "Not configured (no supported scheduler set up). Use Refresh status."],
              ]}
            />
            <p className="mt-3 text-xs text-muted">Modes are controlled by server environment variables only; changing them requires a redeploy/restart. The app never switches from test to live on its own.</p>
          </Card>

          <Card title="Export & backup">
            <form method="post" action="/api/exports/backup">
              <button type="submit" className="btn">Download full JSON export</button>
            </form>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-soft">
              <li>The JSON export contains all records and document metadata, not the files themselves.</li>
              <li>Database: enable Supabase scheduled backups / PITR, or run <code>supabase db dump</code> regularly and store it encrypted.</li>
              <li>Files: copy the <code>consumer-desk-private</code> bucket with the Supabase CLI or S3-compatible tools to encrypted storage you control.</li>
              {ctx.isDemo && <li>Demo data is in memory only; restarting the server erases it.</li>}
            </ul>
          </Card>

          {ctx.isDemo && (
            <Card title="Reset demo data">
              <ActionForm action={resetDemoAction} className="space-y-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required /> Discard all demo changes and reload the three fictional clients.</label>
                <SubmitButton className="btn btn-warn">Reset demo</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>

      <Card title="Before using real client documents" className="mt-4" lit>
        <Notice tone="warn">
          Consumer Desk is not certified as legally compliant and has not been independently security-audited. Complete this checklist first.
        </Notice>
        <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {CHECKLIST.map(([title, text], i) => (
            <li key={title} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
              <p className="font-semibold">{i + 1}. {title}</p>
              <p className="mt-1 text-soft">{text}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
