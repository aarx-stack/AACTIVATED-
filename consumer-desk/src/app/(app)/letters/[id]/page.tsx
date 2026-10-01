import Link from "next/link";
import { notFound } from "next/navigation";
import { createDraftFromPacketAction } from "@/app/actions/letters";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LetterEditor } from "@/components/letter-editor";
import { Badge, Card, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { LETTER_STATUS, PACKET_STATUS, formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getLetterBundle } from "@/server/services/letters";
import { clientAddressText, formatLongDate } from "@/server/services/templates";

export const dynamic = "force-dynamic";

export default async function LetterPage(props: PageProps<"/letters/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requireOwner();
  const bundle = await getLetterBundle(ctx, id);
  if (!bundle) notFound();
  const { letter, client, kase, attachments, clientDocuments, packets, currentPacket, mailings } = bundle;

  const insertFields = [
    { label: "Client name", value: client.full_name },
    { label: "Client address", value: clientAddressText(client) },
    { label: "Client email", value: client.email ?? "" },
    { label: "Client phone", value: client.phone ?? "" },
    { label: "Case title", value: kase.title },
    { label: "Organization", value: kase.organization },
    { label: "Account ending", value: kase.account_last4 ? `account ending in ${kase.account_last4}` : "" },
    { label: "Today's date", value: formatLongDate(new Date(), ctx.timezone) },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={`${client.full_name} · ${kase.title}`}
        title={letter.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={LETTER_STATUS} value={letter.status} prefix="Document: " />
            {client.is_test_record && <Badge tone="amber">TEST RECORD</Badge>}
            {ctx.isDemo && <Badge tone="violet">FICTIONAL DEMO DATA</Badge>}
            {letter.copied_from_packet_id && <Badge tone="blue">Copied from an earlier packet</Badge>}
          </span>
        }
        actions={
          currentPacket ? (
            <Link href={`/packets/${currentPacket.id}`} className="btn btn-primary">
              {currentPacket.status === "approved" ? "View approved packet" : "Review packet"}
            </Link>
          ) : undefined
        }
      />
      {sp.copied === "1" && (
        <div className="mb-4">
          <Notice tone="info">New draft created from an earlier packet. It needs its own packet review and approval before it can be sent.</Notice>
        </div>
      )}

      {letter.locked_at ? (
        <div className="space-y-4">
          <Notice tone="info" title="This letter has a mailing record and is locked">
            The approved packet is kept exactly as it was sent. To mail it again, create a new draft from the packet — it will need a new review
            and approval. There is no “send again” shortcut.
          </Notice>
          <Card title="Letter text (as approved)">
            <pre className="whitespace-pre-wrap font-sans text-sm text-soft">{letter.body}</pre>
          </Card>
          <div className="flex flex-wrap gap-2">
            {mailings.map((m) => (
              <Link key={m.id} href={`/mailings/${m.id}`} className="btn">Open mailing record</Link>
            ))}
            {mailings[0] && (
              <ActionForm action={createDraftFromPacketAction}>
                <input type="hidden" name="packet_id" value={mailings[0].packet_id} />
                <SubmitButton className="btn btn-primary">Create new mailing from this packet</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      ) : (
        <LetterEditor
          letter={{
            id: letter.id,
            title: letter.title,
            letter_type: letter.letter_type,
            body: letter.body,
            recipient_name: letter.recipient_name,
            recipient_address: { ...letter.recipient_address, name: letter.recipient_name || letter.recipient_address.name },
            sender_address: letter.sender_address,
            service: letter.mail_options.service,
            return_receipt: letter.mail_options.return_receipt,
            expects_response: letter.expects_response,
          }}
          attachedIds={attachments.map((a) => a.document_id)}
          documents={clientDocuments.map((d) => ({ id: d.id, filename: d.original_filename, category: d.category, mime: d.mime_type, pages: d.page_count }))}
          insertFields={insertFields}
        />
      )}

      {packets.length > 0 && (
        <Card title="Packet versions" className="mt-6">
          <ul className="divide-y divide-white/5 text-sm">
            {packets.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/packets/${p.id}`} className="hover:text-cyan">
                  Packet {p.id.slice(0, 8)} · {p.page_count} page(s) · created {formatDateTime(p.created_at, ctx.timezone)}
                </Link>
                <span className="flex items-center gap-2">
                  <StatusBadge map={PACKET_STATUS} value={p.status} />
                  {p.invalidation_reason && <span className="text-xs text-muted">{p.invalidation_reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
