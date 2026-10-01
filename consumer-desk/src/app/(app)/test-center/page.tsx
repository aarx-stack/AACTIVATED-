import Link from "next/link";
import { Badge, Card, DefinitionList, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { MAILING_STATUS, formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { LETTERSTREAM_PUBLIC_INFO_URL } from "@/server/mail/letterstream-provider";
import { getConnectionState } from "@/server/services/provider-health";
import { TestConnectionButton } from "./test-buttons";

export const dynamic = "force-dynamic";

const CAPABILITY_LABEL: Record<string, string> = {
  verify_connection: "Test connection (non-mailing verification)",
  quote: "Get quote / price check",
  proof: "Retrieve PDF proof",
  submit: "Submit mailing",
  status: "Check mailing status",
  tracking: "Refresh tracking",
  cancel: "Cancel mailing",
  idempotency: "Provider idempotency keys",
};

export default async function TestCenter() {
  const ctx = await requireOwner();
  const conn = await getConnectionState(ctx);
  const d = conn.descriptor;
  const caps = d?.capabilities;
  const clients = await ctx.store.list("clients", { is_test_record: true });
  const testIds = new Set(clients.map((c) => c.id));
  const testMailings = (await ctx.store.list("mailings")).filter((m) => testIds.has(m.client_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = testMailings[0];

  return (
    <div>
      <PageHeader
        eyebrow="Integration testing"
        title="LetterStream Test Center"
        description="Test the mailing workflow end-to-end with your own test record before using real client information."
      />

      {d?.id === "mock" && (
        <div className="mb-4">
          <Notice tone="info" title={ctx.isDemo ? "Demo mode — mock provider" : "Mock mail mode"}>
            The buttons below exercise the <strong>mock provider</strong>. LetterStream is never contacted, nothing is mailed and nothing is
            charged. Switch to <code>MAIL_MODE=provider_test</code> (connected data mode) to use LetterStream once it is implemented.
          </Notice>
        </div>
      )}
      {d?.id === "letterstream" && d.implementationStatus === "awaiting_documentation" && (
        <div className="mb-4">
          <Notice tone="warn" title="LetterStream integration blocked: account API documentation not supplied">
            No LetterStream requests are made. The adapter is deliberately unconfigured until the documentation from your LetterStream account
            (“My Account” after API approval) is provided and implemented. Nothing about endpoints, authentication, statuses or test behaviour has
            been guessed.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Connection status" lit className="xl:col-span-2">
          <DefinitionList
            items={[
              ["Connection status", <Badge key="c" tone={conn.label === "Verified" ? "green" : conn.label.startsWith("Simulated") ? "violet" : "amber"}>{conn.label}</Badge>],
              ["API / test mode", ctx.policy.label],
              ["Provider", d?.displayName ?? "None (blocked)"],
              ["Account verification status", d?.id === "mock" ? "Not applicable (simulation)" : (conn.row?.verification_status ?? (d?.configured ? "configured_unverified" : "not_configured")).replace(/_/g, " ")],
              ["Missing configuration", d?.missingEnv.length ? d.missingEnv.join(", ") : "None"],
              ["Last successful connection", formatDateTime(conn.lastSuccessfulConnection, ctx.timezone)],
              ["Last API request", conn.row?.last_request_at ? `${conn.row.last_request_operation} · ${formatDateTime(conn.row.last_request_at, ctx.timezone)}` : "—"],
              ["Last API response status", conn.row?.last_response_status ?? "—"],
              ["May create real mail/charges", d?.mayCreateRealMail ? <Badge key="r" tone="red">Yes — confirmation required</Badge> : "No"],
            ]}
          />
          {conn.recentErrors.length > 0 && (
            <div className="mt-4">
              <p className="label">Recent errors / blocked calls</p>
              <ul className="space-y-1 text-xs">
                {conn.recentErrors.map((e) => (
                  <li key={e.id} className="text-soft">
                    {formatDateTime(e.created_at, ctx.timezone)} · {e.operation} · {e.outcome}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Actions">
          <div className="space-y-2">
            {caps?.verify_connection.supported && <TestConnectionButton label="TEST CONNECTION" />}
            <Link href="/test-center/wizard" className="btn w-full" data-testid="create-test-packet">CREATE TEST PACKET</Link>
            {latest && <Link href={`/packets/${latest.packet_id}`} className="btn w-full">PREVIEW TEST PACKET</Link>}
            {caps?.quote.supported && <Link href="/test-center/wizard" className="btn w-full">GET QUOTE</Link>}
            {caps?.submit.supported && <Link href="/test-center/wizard" className="btn w-full">SUBMIT TEST MAILING</Link>}
            {caps?.status.supported && latest && <Link href={`/mailings/${latest.id}`} className="btn w-full">CHECK MAILING STATUS</Link>}
            {caps?.tracking.supported && latest && <Link href={`/mailings/${latest.id}`} className="btn w-full">REFRESH TRACKING</Link>}
          </div>
          <p className="mt-3 text-xs text-muted">Only functions confirmed for the active provider are shown. Test mailings are never sent automatically.</p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={`Capabilities · ${d?.displayName ?? "no provider"}`}>
          <ul className="divide-y divide-white/5 text-sm">
            {caps &&
              Object.entries(caps).map(([k, c]) => (
                <li key={k} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
                  <span className="font-medium">{CAPABILITY_LABEL[k] ?? k}</span>
                  <span className="sm:max-w-[60%] sm:text-right">
                    <Badge tone={c.supported ? "green" : "gray"}>{c.supported ? "Available" : "Not available"}</Badge>
                    <span className="mt-1 block text-xs text-muted">{c.basis}</span>
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs font-semibold text-soft">Services</p>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {d?.services.map((s) => (
              <li key={s.value}>
                {s.label}: {s.supported ? "available" : "not confirmed"} · return receipt {s.supportsReturnReceipt ? "available" : "not confirmed"} · tracking {s.tracking.replace("_", " ")} — {s.note}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="What you need to provide to connect LetterStream">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-soft">
            <li>A LetterStream account, and API access approved by LetterStream support (email support@letterstream.com from your account email describing your use, volume and the “Automation” mode).</li>
            <li>The API documentation LetterStream shares after approval (it appears under “My Account”): endpoints, authentication, request/response fields, status values, test procedure, PDF and address-layout rules.</li>
            <li>Test credentials, set only as server environment variables: <code>LETTERSTREAM_TEST_API_ID</code>, <code>LETTERSTREAM_TEST_API_KEY</code>, <code>LETTERSTREAM_TEST_BASE_URL</code>.</li>
            <li>Written confirmation of whether LetterStream&apos;s test access creates physical mail or charges.</li>
            <li>Which services your account can use (First-Class, Certified, return receipt) and whether a quote/price check, proofs, tracking and a non-mailing verification call exist.</li>
            <li>Funding: API jobs are not produced until paid. Decide yourself whether to pre-fund — the app never funds an account or buys postage.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">
            Public source: <a className="text-cyan underline" href={LETTERSTREAM_PUBLIC_INFO_URL} target="_blank" rel="noreferrer">{LETTERSTREAM_PUBLIC_INFO_URL}</a> (reviewed 2026-09-30).
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Test mailings">
          {testMailings.length === 0 ? (
            <p className="text-sm text-muted">No test mailings yet. Use “Create test packet”.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {testMailings.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/mailings/${m.id}`} className="hover:text-cyan">{m.provider_reference ?? "No reference"} · {formatDateTime(m.created_at, ctx.timezone)}</Link>
                  <StatusBadge map={MAILING_STATUS} value={m.mailing_status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent provider API log">
          {conn.recentLog.length === 0 ? (
            <p className="text-sm text-muted">No provider calls recorded.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {conn.recentLog.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-2 text-soft">
                  <span className="text-muted">{formatDateTime(l.created_at, ctx.timezone)}</span>
                  <code>{l.operation}</code>
                  <Badge tone={l.outcome === "ok" ? "green" : l.outcome === "blocked" ? "amber" : "red"}>{l.outcome}</Badge>
                  <span>{l.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[0.7rem] text-muted">Only operation, outcome and short messages are logged — never credentials or document contents.</p>
        </Card>
      </div>
    </div>
  );
}
