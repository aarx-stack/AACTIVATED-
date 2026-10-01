import { createFollowUpAction, toggleFollowUpAction } from "@/app/actions/responses";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientCasePicker } from "@/components/pickers";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { FOLLOW_UP_KIND, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { followUpBuckets } from "@/server/services/metrics";
import { addDays, todayIn } from "@/server/services/time";
import type { FollowUpRow } from "@/server/types";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const ctx = await requireOwner();
  const today = todayIn(ctx.timezone);
  const [followUps, clients, cases] = await Promise.all([ctx.store.list("follow_ups"), ctx.store.list("clients"), ctx.store.list("cases")]);
  const b = followUpBuckets(followUps, today);
  const clientName = new Map(clients.map((c) => [c.id, c.full_name]));
  const caseTitle = new Map(cases.map((c) => [c.id, c.title]));

  const list = (title: string, rows: FollowUpRow[], tone: string, done = false) => (
    <Card title={<span className="flex items-center gap-2">{title} <Badge tone={tone}>{rows.length}</Badge></span>}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.slice(0, done ? 15 : 100).map((f) => (
            <li key={f.id} id={`fu-${f.id}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className={`font-medium ${done ? "line-through opacity-60" : ""}`}>{f.title}</p>
                <p className="text-xs text-muted">
                  {FOLLOW_UP_KIND[f.kind]} · {clientName.get(f.client_id)} · {caseTitle.get(f.case_id ?? "") ?? "No case"} · due {formatDate(f.due_date)}
                </p>
              </div>
              <ActionForm action={toggleFollowUpAction}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="done" value={done ? "false" : "true"} />
                <SubmitButton className="btn btn-sm">{done ? "Reopen" : "Mark done"}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Your own review reminders. The app never calculates legal or statutory deadlines, never resends letters and never creates new disputes — you decide what to do."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {list("Overdue", b.overdue, "red")}
          {list("Due today", b.dueToday, "amber")}
          {list("Next 7 days", b.next7, "cyan")}
          {list("Later", b.later, "blue")}
          {list("Completed", b.completed, "green", true)}
        </div>
        <Card title="Create follow-up" lit className="h-fit">
          <ActionForm action={createFollowUpAction} className="space-y-3">
            <ClientCasePicker
              clients={clients.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.full_name }))}
              cases={cases.map((c) => ({ id: c.id, clientId: c.client_id, title: c.title }))}
              caseRequired={false}
            />
            <Field label="Type">
              <select className="select" name="kind" defaultValue="review_case">
                {Object.entries(FOLLOW_UP_KIND).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Title *"><input className="input" name="title" required /></Field>
            <Field label="Due date *"><input className="input" type="date" name="due_date" required defaultValue={addDays(today, 7)} /></Field>
            <Field label="Notes"><input className="input" name="notes" /></Field>
            <SubmitButton>Create follow-up</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
