import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { submitMailingAction } from "@/app/actions/mailings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AddressBlock, Badge, Card, DefinitionList, Field, Notice, PageHeader } from "@/components/ui";
import { SERVICE, formatAddress, money } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getPacketBundle } from "@/server/services/packets";
import { activeProvider } from "@/server/services/provider-health";

export const dynamic = "force-dynamic";
// Mail submission waits up to 30 s for the provider; allow headroom on serverless hosts.
export const maxDuration = 60;

export default async function SendPage(props: PageProps<"/packets/[id]/send">) {
  const { id } = await props.params;
  const ctx = await requireOwner();
  const bundle = await getPacketBundle(ctx, id);
  if (!bundle) notFound();
  const { packet, client, mailing } = bundle;
  if (mailing) redirect(`/mailings/${mailing.id}`);
  if (packet.status !== "approved") redirect(`/packets/${packet.id}`);

  const policy = ctx.policy;
  const descriptor = activeProvider(ctx)?.descriptor() ?? null;
  const service = descriptor?.services.find((s) => s.value === packet.mail_options.service);
  const blockers = [
    !policy.canSubmit && policy.blockedReason,
    descriptor && !descriptor.capabilities.submit.supported && `Submission: ${descriptor.capabilities.submit.basis}`,
    descriptor && !descriptor.configured && `Missing configuration: ${descriptor.missingEnv.join(", ")}`,
    service && !service.supported && `${service.label}: ${service.note}`,
    packet.mail_options.return_receipt && service && !service.supportsReturnReceipt && "Return receipt is not confirmed for this provider.",
  ].filter(Boolean) as string[];
  const isMock = descriptor?.id === "mock";

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={client.full_name} title="Final send confirmation" description="Last check before submitting this exact approved packet." />

      {policy.mayCreateRealMail && (
        <div className="mb-4">
          <Notice tone="danger" title="THIS ACTION MAY CREATE A REAL MAILING AND INCUR A CHARGE.">
            Submitting sends this packet to {descriptor?.displayName}. Submission is not the same as mailing: the provider may still require
            funding before production.
          </Notice>
        </div>
      )}
      {isMock && (
        <div className="mb-4">
          <Notice tone="info" title="Mock provider — simulation only">
            Nothing will be printed, mailed or charged. The mailing record will be labelled “Simulated”.
          </Notice>
        </div>
      )}

      <Card lit>
        <DefinitionList
          items={[
            ["Recipient", <AddressBlock key="r" lines={formatAddress(packet.recipient_snapshot)} />],
            ["Pages", packet.page_count],
            ["Mailing type", `${SERVICE[packet.mail_options.service]}${packet.mail_options.return_receipt ? " + return receipt" : ""}`],
            [
              "Quoted cost",
              packet.quote_cents !== null
                ? money(packet.quote_cents, packet.quote_currency ?? "USD")
                : `Not available — ${descriptor?.capabilities.quote.basis ?? "no provider"}`,
            ],
            ["Environment / mode", <Badge key="m" tone={policy.indicator === "LIVE" ? "red" : policy.indicator === "PROVIDER TEST" ? "amber" : "cyan"}>{policy.label}</Badge>],
            ["Provider", descriptor?.displayName ?? "None"],
          ]}
        />
      </Card>

      {blockers.length > 0 ? (
        <div className="mt-4">
          <Notice tone="danger" title="Sending is blocked">
            <ul className="list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="mt-2">You can still download the packet PDF or record a manual mailing from the packet page.</p>
          </Notice>
          <Link href={`/packets/${packet.id}`} className="btn mt-3">Back to packet</Link>
        </div>
      ) : (
        <Card className="mt-4" title="Confirm and send">
          <ActionForm action={submitMailingAction} className="space-y-3" testId="send-form">
            <input type="hidden" name="packet_id" value={packet.id} />
            <input type="hidden" name="packet_hash" value={packet.packet_hash} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm_final" required className="mt-1" data-testid="confirm-final" />
              <span>I reviewed this exact approved packet (hash {packet.packet_hash.slice(0, 12)}…) and want to submit it now.</span>
            </label>
            {policy.mayCreateRealMail && (
              <label className="flex items-start gap-2 text-sm font-semibold text-[#ffd6dc]">
                <input type="checkbox" name="acknowledge_charges" required className="mt-1" />
                <span>I understand this may result in a physical mailing and a charge.</span>
              </label>
            )}
            {isMock && (
              <Field label="Simulated provider response (testing only)" hint="Lets you rehearse failure handling. Ignored by real providers.">
                <select className="select" name="simulate" defaultValue="accept" data-testid="simulate-select">
                  <option value="accept">Accepted</option>
                  <option value="accept_awaiting_funding">Accepted, awaiting funding</option>
                  <option value="reject">Rejected</option>
                  <option value="timeout">Timeout (outcome unknown)</option>
                </select>
              </Field>
            )}
            <SubmitButton className={policy.mayCreateRealMail ? "btn btn-danger" : "btn btn-primary"} pendingLabel="Submitting — do not close…" testId="send-mailing">
              {isMock ? "Submit simulated mailing" : "Send mailing"}
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
