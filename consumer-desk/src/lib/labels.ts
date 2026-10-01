// Human labels and badge colours for each (separate) status type. Shared by server and client.

type Tone = "blue" | "cyan" | "violet" | "green" | "amber" | "red" | "gray";

export const CASE_STATUS: Record<string, [string, Tone]> = {
  open: ["Open", "blue"],
  waiting: ["Waiting", "violet"],
  action_required: ["Action required", "amber"],
  closed: ["Closed", "gray"],
};

export const LETTER_STATUS: Record<string, [string, Tone]> = {
  draft: ["Draft", "gray"],
  ready_for_review: ["Ready for review", "amber"],
  approved: ["Approved", "green"],
  superseded: ["Superseded", "gray"],
};

export const PACKET_STATUS: Record<string, [string, Tone]> = {
  pending_review: ["Awaiting approval", "amber"],
  approved: ["Approved", "green"],
  invalidated: ["Invalidated", "red"],
};

export const MAILING_STATUS: Record<string, [string, Tone]> = {
  not_submitted: ["Not submitted", "gray"],
  submitting: ["Submitting", "cyan"],
  submission_unknown: ["Submission outcome unknown", "red"],
  accepted: ["Accepted by provider", "blue"],
  processing: ["Processing", "violet"],
  mailed: ["Mailed", "cyan"],
  failed: ["Failed", "red"],
  cancelled: ["Cancelled", "gray"],
};

export const DELIVERY_STATUS: Record<string, [string, Tone]> = {
  not_available: ["Not available for this service", "gray"],
  pending: ["Pending", "gray"],
  in_transit: ["In transit", "violet"],
  delivered: ["Delivered", "green"],
  delivery_exception: ["Delivery exception", "red"],
  unknown: ["Unknown", "gray"],
};

export const RESPONSE_STATUS: Record<string, [string, Tone]> = {
  not_submitted: ["—", "gray"],
  not_expected: ["Not expected", "gray"],
  awaiting_response: ["Awaiting response", "violet"],
  response_received: ["Response received", "cyan"],
  review_needed: ["Review needed", "amber"],
  reviewed: ["Reviewed", "green"],
  follow_up_required: ["Follow-up required", "amber"],
  resolved: ["Resolved", "green"],
};

export const DOCUMENT_CATEGORY: Record<string, string> = {
  supporting_evidence: "Supporting evidence",
  correspondence: "Correspondence",
  authorization: "Authorization",
  prepared_letter: "Prepared letter",
  mailing_proof: "Mailing proof / receipt",
  response: "Response",
};

export const FOLLOW_UP_KIND: Record<string, string> = {
  review_response: "Review response",
  check_delivery: "Check delivery",
  contact_client: "Contact client",
  prepare_next_correspondence: "Prepare next correspondence",
  review_case: "Review case",
  other: "Other",
};

export const EVENT_SOURCE: Record<string, [string, Tone]> = {
  owner: ["Entered by you", "blue"],
  system: ["App (automatic)", "gray"],
  provider: ["Provider reported", "cyan"],
  simulation: ["Simulated provider", "violet"],
};

export const RECORD_ORIGIN: Record<string, [string, Tone]> = {
  simulated: ["Simulated", "violet"],
  api_reported: ["API reported", "cyan"],
  manually_recorded: ["Manually recorded", "amber"],
};

export const SERVICE: Record<string, string> = {
  first_class: "First-Class",
  certified: "Certified",
};

export function labelOf(map: Record<string, [string, Tone]>, key: string | null | undefined): [string, Tone] {
  if (!key) return ["—", "gray"];
  return map[key] ?? [key.replace(/_/g, " "), "gray"];
}

export function formatDate(iso: string | null | undefined, timezone = "America/Los_Angeles"): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: iso.length === 10 ? "UTC" : timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, timezone = "America/Los_Angeles"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatAddress(a: { name?: string; line1?: string; line2?: string; city?: string; state?: string; postal_code?: string }) {
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.name, a.line1, a.line2, cityLine].filter(Boolean) as string[];
}
