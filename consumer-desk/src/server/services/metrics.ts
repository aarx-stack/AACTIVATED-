import type {
  CaseRow,
  ClientRow,
  FollowUpRow,
  LetterRow,
  MailingRow,
  PacketRow,
  ResponseRow,
} from "../types";
import type { Ctx } from "./ctx";
import { addDays, dateOnlyIn, daysBetween, todayIn } from "./time";

export interface Dataset {
  clients: ClientRow[];
  cases: CaseRow[];
  letters: LetterRow[];
  packets: PacketRow[];
  mailings: MailingRow[];
  responses: ResponseRow[];
  followUps: FollowUpRow[];
}

export async function loadDataset(ctx: Ctx): Promise<Dataset> {
  const [clients, cases, letters, packets, mailings, responses, followUps] = await Promise.all([
    ctx.store.list("clients"),
    ctx.store.list("cases"),
    ctx.store.list("letters"),
    ctx.store.list("mailing_packets"),
    ctx.store.list("mailings"),
    ctx.store.list("responses"),
    ctx.store.list("follow_ups"),
  ]);
  return { clients, cases, letters, packets, mailings, responses, followUps };
}

export interface RecordRef {
  kind: "client" | "case" | "letter" | "packet" | "mailing" | "response" | "follow_up";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  date: string | null;
}

export const SUBMITTED_STATUSES = new Set(["submitting", "submission_unknown", "accepted", "processing"]);
const LIVE_MAILING_STATUSES = new Set(["accepted", "processing", "mailed"]);

function lookup(ds: Dataset) {
  const client = new Map(ds.clients.map((c) => [c.id, c]));
  const kase = new Map(ds.cases.map((c) => [c.id, c]));
  const letter = new Map(ds.letters.map((l) => [l.id, l]));
  const packet = new Map(ds.packets.map((p) => [p.id, p]));
  return {
    clientName: (id: string) => client.get(id)?.full_name ?? "Unknown client",
    caseTitle: (id: string | null) => (id ? (kase.get(id)?.title ?? "Unknown case") : "No case"),
    letterFor: (packetId: string) => letter.get(packet.get(packetId)?.letter_id ?? ""),
  };
}

function mailingRef(ds: Dataset, m: MailingRow, date: string | null): RecordRef {
  const l = lookup(ds);
  return {
    kind: "mailing",
    id: m.id,
    title: `${l.clientName(m.client_id)} → ${m.recipient_snapshot.name ?? "recipient"}`,
    subtitle: `${l.caseTitle(m.case_id)} · ${m.mailing_status.replace(/_/g, " ")}`,
    href: `/mailings/${m.id}`,
    date,
  };
}

function packetRef(ds: Dataset, p: PacketRow): RecordRef {
  const l = lookup(ds);
  return {
    kind: "packet",
    id: p.id,
    title: `${l.clientName(p.client_id)} → ${p.recipient_snapshot.name ?? "recipient"}`,
    subtitle: `${l.caseTitle(p.case_id)} · ${p.page_count} pages`,
    href: `/packets/${p.id}`,
    date: p.approved_at ?? p.created_at,
  };
}

function responseRef(ds: Dataset, r: ResponseRow): RecordRef {
  const l = lookup(ds);
  return {
    kind: "response",
    id: r.id,
    title: `${l.clientName(r.client_id)} ← ${r.sender_name || "sender not recorded"}`,
    subtitle: `${l.caseTitle(r.case_id)} · ${r.status.replace(/_/g, " ")}`,
    href: `/responses/${r.id}`,
    date: r.received_date,
  };
}

function caseRef(ds: Dataset, c: CaseRow): RecordRef {
  const l = lookup(ds);
  return {
    kind: "case",
    id: c.id,
    title: c.title,
    subtitle: `${l.clientName(c.client_id)} · ${c.status.replace(/_/g, " ")}`,
    href: `/clients/${c.client_id}?tab=cases#case-${c.id}`,
    date: c.updated_at,
  };
}

function followUpRef(ds: Dataset, f: FollowUpRow): RecordRef {
  const l = lookup(ds);
  return {
    kind: "follow_up",
    id: f.id,
    title: f.title,
    subtitle: `${l.clientName(f.client_id)} · ${l.caseTitle(f.case_id)}`,
    href: `/follow-ups#fu-${f.id}`,
    date: f.due_date,
  };
}

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  select: (ds: Dataset, today: string) => RecordRef[];
}

export const METRICS: MetricDefinition[] = [
  {
    key: "total_clients",
    label: "Total clients",
    description: "Client records that are not archived.",
    select: (ds) =>
      ds.clients
        .filter((c) => !c.archived_at)
        .map((c) => ({
          kind: "client",
          id: c.id,
          title: c.full_name,
          subtitle: c.is_test_record ? "Test record" : [c.city, c.state].filter(Boolean).join(", "),
          href: `/clients/${c.id}`,
          date: c.created_at,
        })),
  },
  {
    key: "active_cases",
    label: "Active cases",
    description: "Cases whose case status is not Closed.",
    select: (ds) => ds.cases.filter((c) => c.status !== "closed").map((c) => caseRef(ds, c)),
  },
  {
    key: "draft_letters",
    label: "Draft letters",
    description: "Letters in Draft status (not yet in a packet awaiting review).",
    select: (ds) => {
      const l = lookup(ds);
      return ds.letters
        .filter((x) => x.status === "draft")
        .map((x) => ({
          kind: "letter" as const,
          id: x.id,
          title: x.title,
          subtitle: `${l.clientName(x.client_id)} · ${l.caseTitle(x.case_id)}`,
          href: `/letters/${x.id}`,
          date: x.updated_at,
        }));
    },
  },
  {
    key: "awaiting_approval",
    label: "Awaiting approval",
    description: "Generated packets waiting for your review and approval.",
    select: (ds) => ds.packets.filter((p) => p.status === "pending_review").map((p) => packetRef(ds, p)),
  },
  {
    key: "ready_to_send",
    label: "Ready to send",
    description: "Approved packets with no mailing record yet.",
    select: (ds) => {
      const mailed = new Set(ds.mailings.map((m) => m.packet_id));
      return ds.packets.filter((p) => p.status === "approved" && !mailed.has(p.id)).map((p) => packetRef(ds, p));
    },
  },
  {
    key: "submitted",
    label: "Submitted",
    description: "Mailings submitted/accepted but not yet reported mailed (includes unknown outcomes).",
    select: (ds) =>
      ds.mailings.filter((m) => SUBMITTED_STATUSES.has(m.mailing_status)).map((m) => mailingRef(ds, m, m.submitted_at)),
  },
  {
    key: "mailed",
    label: "Mailed",
    description: "Mailings whose mailing status is Mailed (reported by the provider, simulated, or manually recorded).",
    select: (ds) => ds.mailings.filter((m) => m.mailing_status === "mailed").map((m) => mailingRef(ds, m, m.mailed_at)),
  },
  {
    key: "delivered",
    label: "Delivered",
    description: "Mailings whose delivery status is Delivered (from tracking, never assumed).",
    select: (ds) =>
      ds.mailings.filter((m) => m.delivery_status === "delivered").map((m) => mailingRef(ds, m, m.delivered_at)),
  },
  {
    key: "awaiting_response",
    label: "Awaiting response",
    description: "Accepted, processing or mailed mailings where a response is expected and none is recorded.",
    select: (ds) =>
      ds.mailings
        .filter((m) => m.response_status === "awaiting_response" && LIVE_MAILING_STATUSES.has(m.mailing_status))
        .map((m) => mailingRef(ds, m, m.mailed_at ?? m.submitted_at)),
  },
  {
    key: "responses_received",
    label: "Responses received",
    description: "Every response you have recorded or uploaded.",
    select: (ds) => ds.responses.map((r) => responseRef(ds, r)),
  },
  {
    key: "review_needed",
    label: "Response review needed",
    description: "Responses marked Response received or Review needed.",
    select: (ds) =>
      ds.responses
        .filter((r) => r.status === "review_needed" || r.status === "response_received")
        .map((r) => responseRef(ds, r)),
  },
  {
    key: "follow_ups_due",
    label: "Follow-ups due",
    description: "Open follow-ups due today or earlier (your own reminders, not legal deadlines).",
    select: (ds, today) =>
      ds.followUps.filter((f) => !f.completed_at && f.due_date <= today).map((f) => followUpRef(ds, f)),
  },
  {
    key: "closed_cases",
    label: "Closed cases",
    description: "Cases whose case status is Closed.",
    select: (ds) => ds.cases.filter((c) => c.status === "closed").map((c) => caseRef(ds, c)),
  },
  {
    key: "needs_attention",
    label: "Mailings requiring attention",
    description: "Unknown submission outcomes, failures, delivery exceptions and jobs awaiting funding.",
    select: (ds) =>
      ds.mailings
        .filter(
          (m) =>
            m.mailing_status === "submission_unknown" ||
            m.mailing_status === "failed" ||
            m.delivery_status === "delivery_exception" ||
            m.awaiting_funding,
        )
        .map((m) => mailingRef(ds, m, m.updated_at)),
  },
];

export function computeMetrics(ds: Dataset, today: string) {
  return METRICS.map((m) => {
    const records = m.select(ds, today);
    return { key: m.key, label: m.label, description: m.description, count: records.length, records };
  });
}

// ---------------------------------------------------------------------------------------------
// Dispute tracker: one row per letter
// ---------------------------------------------------------------------------------------------

export const TRACKER_FILTERS = [
  ["all", "All"],
  ["draft", "Draft"],
  ["awaiting_approval", "Awaiting approval"],
  ["ready", "Ready"],
  ["submitted", "Submitted"],
  ["mailed", "Mailed"],
  ["delivered", "Delivered"],
  ["awaiting_response", "Awaiting response"],
  ["response_received", "Response received"],
  ["needs_review", "Needs review"],
  ["follow_up_due", "Follow-up due"],
  ["closed", "Closed"],
] as const;
export type TrackerFilter = (typeof TRACKER_FILTERS)[number][0];

export interface TrackerRow {
  letterId: string;
  clientId: string;
  clientName: string;
  isTestRecord: boolean;
  caseId: string;
  caseTitle: string;
  caseStatus: string;
  recipient: string;
  letterType: string;
  letterStatus: string;
  created: string;
  approved: string | null;
  submitted: string | null;
  mailingId: string | null;
  packetId: string | null;
  mailingStatus: string;
  providerStatusRaw: string | null;
  recordOrigin: string | null;
  trackingNumber: string | null;
  trackingSupported: boolean;
  deliveryStatus: string;
  responseStatus: string;
  followUpDate: string | null;
  daysSinceMailing: number | null;
  daysBasis: "mailed" | "submitted" | null;
  assignedTo: string;
  nextAction: string;
  providerReference: string | null;
  stages: TrackerFilter[];
}

export function trackerRows(ds: Dataset, today: string, timezone: string, assignedTo: string): TrackerRow[] {
  const client = new Map(ds.clients.map((c) => [c.id, c]));
  const kase = new Map(ds.cases.map((c) => [c.id, c]));
  return ds.letters
    .map((letter) => {
      const packets = ds.packets
        .filter((p) => p.letter_id === letter.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const current = packets.find((p) => p.status !== "invalidated") ?? null;
      const mailing = ds.mailings.find((m) => packets.some((p) => p.id === m.packet_id)) ?? null;
      const c = kase.get(letter.case_id);
      const responses = mailing ? ds.responses.filter((r) => r.mailing_id === mailing.id) : [];
      const openFollowUps = ds.followUps
        .filter((f) => !f.completed_at && ((mailing && f.mailing_id === mailing.id) || (!f.mailing_id && f.case_id === letter.case_id)))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
      const mailedDate = mailing?.mailed_at ? dateOnlyIn(timezone, mailing.mailed_at) : null;
      const submittedDate = mailing?.submitted_at ? dateOnlyIn(timezone, mailing.submitted_at) : null;
      const basisDate = mailedDate ?? submittedDate;

      const stages: TrackerFilter[] = ["all"];
      if (!mailing && letter.status === "draft") stages.push("draft");
      if (!mailing && current?.status === "pending_review") stages.push("awaiting_approval");
      if (!mailing && current?.status === "approved") stages.push("ready");
      if (mailing && SUBMITTED_STATUSES.has(mailing.mailing_status)) stages.push("submitted");
      if (mailing?.mailing_status === "mailed") stages.push("mailed");
      if (mailing?.delivery_status === "delivered") stages.push("delivered");
      if (mailing && mailing.response_status === "awaiting_response" && LIVE_MAILING_STATUSES.has(mailing.mailing_status))
        stages.push("awaiting_response");
      if (responses.length > 0) stages.push("response_received");
      if (responses.some((r) => r.status === "review_needed" || r.status === "response_received")) stages.push("needs_review");
      if (openFollowUps.some((f) => f.due_date <= today)) stages.push("follow_up_due");
      if (c?.status === "closed") stages.push("closed");

      const latestResponse = responses.sort((a, b) => b.received_date.localeCompare(a.received_date))[0];
      return {
        letterId: letter.id,
        clientId: letter.client_id,
        clientName: client.get(letter.client_id)?.full_name ?? "Unknown",
        isTestRecord: client.get(letter.client_id)?.is_test_record ?? false,
        caseId: letter.case_id,
        caseTitle: c?.title ?? "Unknown",
        caseStatus: c?.status ?? "open",
        recipient: letter.recipient_name || letter.recipient_address.name || "—",
        letterType: letter.letter_type,
        letterStatus: letter.status,
        created: letter.created_at,
        approved: (mailing ? packets.find((p) => p.id === mailing.packet_id)?.approved_at : current?.approved_at) ?? null,
        submitted: mailing?.submitted_at ?? null,
        mailingId: mailing?.id ?? null,
        packetId: mailing?.packet_id ?? current?.id ?? null,
        mailingStatus: mailing?.mailing_status ?? "not_submitted",
        providerStatusRaw: mailing?.provider_status_raw ?? null,
        recordOrigin: mailing?.record_origin ?? null,
        trackingNumber: mailing?.tracking_number ?? null,
        trackingSupported: mailing?.tracking_supported ?? false,
        deliveryStatus: mailing?.delivery_status ?? "not_available",
        responseStatus: latestResponse?.status ?? mailing?.response_status ?? (letter.expects_response ? "not_submitted" : "not_expected"),
        followUpDate: openFollowUps[0]?.due_date ?? null,
        daysSinceMailing: basisDate ? daysBetween(basisDate, today) : null,
        daysBasis: mailedDate ? ("mailed" as const) : submittedDate ? ("submitted" as const) : null,
        assignedTo,
        nextAction: latestResponse?.next_action || c?.next_action || "",
        providerReference: mailing?.provider_reference ?? null,
        stages,
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function filterTrackerRows(rows: TrackerRow[], filter: TrackerFilter, q: string): TrackerRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      r.stages.includes(filter) &&
      (!needle ||
        [r.clientName, r.caseTitle, r.recipient, r.trackingNumber, r.providerReference].some((v) =>
          (v ?? "").toLowerCase().includes(needle),
        )),
  );
}

// ---------------------------------------------------------------------------------------------
// Follow-up buckets and analytics
// ---------------------------------------------------------------------------------------------

export function followUpBuckets(followUps: FollowUpRow[], today: string) {
  const open = followUps.filter((f) => !f.completed_at).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const in7 = addDays(today, 7);
  return {
    overdue: open.filter((f) => f.due_date < today),
    dueToday: open.filter((f) => f.due_date === today),
    next7: open.filter((f) => f.due_date > today && f.due_date <= in7),
    later: open.filter((f) => f.due_date > in7),
    completed: followUps.filter((f) => f.completed_at).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!)),
  };
}

export const ANALYTICS_RANGES = { "7": 7, "30": 30, "90": 90, all: null } as const;
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

export function computeAnalytics(ds: Dataset, range: AnalyticsRange, timezone: string, now = new Date()) {
  const today = todayIn(timezone, now);
  const days = ANALYTICS_RANGES[range];
  const start = days === null ? null : addDays(today, -(days - 1));
  const inRange = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = iso.length === 10 ? iso : dateOnlyIn(timezone, iso);
    return start === null || d >= start;
  };

  const approvedLetters = new Set(ds.packets.filter((p) => p.status === "approved" && inRange(p.approved_at)).map((p) => p.letter_id));
  const mailingById = new Map(ds.mailings.map((m) => [m.id, m]));
  const gaps: number[] = [];
  for (const r of ds.responses) {
    if (!r.mailing_id || !inRange(r.received_date)) continue;
    const m = mailingById.get(r.mailing_id);
    const basis = m?.mailed_at ?? null;
    if (!basis) continue;
    gaps.push(daysBetween(dateOnlyIn(timezone, basis), r.received_date));
  }
  const costed = ds.mailings.filter((m) => m.actual_cost_cents !== null && inRange(m.submitted_at ?? m.mailed_at));
  const spendCents = costed.reduce((sum, m) => sum + (m.actual_cost_cents ?? 0), 0);

  const cards = [
    { key: "letters_created", label: "Letters created", value: ds.letters.filter((l) => inRange(l.created_at)).length as number | null, note: "" },
    { key: "letters_approved", label: "Letters approved", value: approvedLetters.size, note: "Letters with a packet approved in range" },
    { key: "submitted", label: "Mailings submitted", value: ds.mailings.filter((m) => inRange(m.submitted_at)).length, note: "" },
    {
      key: "mailed",
      label: "Reported mailed",
      value: ds.mailings.filter((m) => inRange(m.mailed_at)).length,
      note: "Provider, simulated or manually recorded",
    },
    { key: "delivered", label: "Reported delivered", value: ds.mailings.filter((m) => inRange(m.delivered_at)).length, note: "From tracking only" },
    { key: "responses", label: "Responses recorded", value: ds.responses.filter((r) => inRange(r.received_date)).length, note: "" },
    { key: "cases_opened", label: "Cases opened", value: ds.cases.filter((c) => inRange(c.created_at)).length, note: "" },
    { key: "cases_closed", label: "Cases closed", value: ds.cases.filter((c) => inRange(c.closed_at)).length, note: "" },
    {
      key: "avg_days",
      label: "Avg. days mailed → response",
      value: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
      note: gaps.length ? `Based on ${gaps.length} response${gaps.length === 1 ? "" : "s"} linked to a mailed item` : "Not enough data",
    },
    {
      key: "spend",
      label: "Mailing spend",
      value: costed.length ? spendCents / 100 : null,
      note: costed.length ? `Actual costs on ${costed.length} mailing${costed.length === 1 ? "" : "s"}` : "No actual provider costs recorded",
    },
  ];

  // Weekly series (Mon-start weeks) for the chart.
  const weekStart = (date: string) => {
    const d = new Date(`${date}T12:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;
    return addDays(date, -dow);
  };
  const firstDate =
    start ??
    [...ds.letters.map((l) => l.created_at), ...ds.mailings.map((m) => m.submitted_at ?? ""), ...ds.responses.map((r) => r.received_date)]
      .filter(Boolean)
      .map((d) => (d.length === 10 ? d : dateOnlyIn(timezone, d)))
      .sort()[0] ??
    today;
  const weeks: { week: string; letters: number; mailings: number; responses: number }[] = [];
  for (let w = weekStart(firstDate); w <= today && weeks.length < 60; w = addDays(w, 7)) {
    weeks.push({ week: w, letters: 0, mailings: 0, responses: 0 });
  }
  const bump = (iso: string | null, key: "letters" | "mailings" | "responses") => {
    if (!iso || !inRange(iso)) return;
    const d = iso.length === 10 ? iso : dateOnlyIn(timezone, iso);
    const row = weeks.find((x) => x.week === weekStart(d));
    if (row) row[key]++;
  };
  ds.letters.forEach((l) => bump(l.created_at, "letters"));
  ds.mailings.forEach((m) => bump(m.submitted_at, "mailings"));
  ds.responses.forEach((r) => bump(r.received_date, "responses"));

  return { range, start, today, cards, weeks };
}
