// Row types mirror supabase/migrations/*.sql exactly (snake_case), so the demo adapter and the
// Supabase adapter can share one set of services.

export const CASE_STATUSES = ["open", "waiting", "action_required", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const LETTER_STATUSES = ["draft", "ready_for_review", "approved", "superseded"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const PACKET_STATUSES = ["pending_review", "approved", "invalidated"] as const;
export type PacketStatus = (typeof PACKET_STATUSES)[number];

export const MAILING_STATUSES = [
  "not_submitted",
  "submitting",
  "submission_unknown",
  "accepted",
  "processing",
  "mailed",
  "failed",
  "cancelled",
] as const;
export type MailingStatus = (typeof MAILING_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "not_available",
  "pending",
  "in_transit",
  "delivered",
  "delivery_exception",
  "unknown",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const RESPONSE_STATUSES = [
  "not_expected",
  "awaiting_response",
  "response_received",
  "review_needed",
  "reviewed",
  "follow_up_required",
  "resolved",
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** Statuses a response record itself may hold (a subset of ResponseStatus). */
export const RESPONSE_RECORD_STATUSES = [
  "response_received",
  "review_needed",
  "reviewed",
  "follow_up_required",
  "resolved",
] as const;
export type ResponseRecordStatus = (typeof RESPONSE_RECORD_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  "supporting_evidence",
  "correspondence",
  "authorization",
  "prepared_letter",
  "mailing_proof",
  "response",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const MAIL_MODES = ["mock", "provider_test", "live", "manual"] as const;
export type MailMode = (typeof MAIL_MODES)[number];

export const EVENT_SOURCES = ["owner", "system", "provider", "simulation"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const FOLLOW_UP_KINDS = [
  "review_response",
  "check_delivery",
  "contact_client",
  "prepare_next_correspondence",
  "review_case",
  "other",
] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const PREFERRED_CONTACTS = ["email", "phone", "mail", "none"] as const;
export type PreferredContact = (typeof PREFERRED_CONTACTS)[number];

export type RecordOrigin = "simulated" | "api_reported" | "manually_recorded";
export type ProviderId = "mock" | "letterstream" | "manual";

export interface Address {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface MailOptions {
  /** Availability depends on the active provider's confirmed capabilities. */
  service: "first_class" | "certified";
  return_receipt: boolean;
}

export interface AppSettingsRow {
  owner_id: string;
  app_name: string;
  accent_primary: string;
  accent_highlight: string;
  accent_violet: string;
  timezone: string;
  return_address: Address;
  updated_at: string;
}

export interface ClientRow {
  id: string;
  owner_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  preferred_contact: PreferredContact;
  notes: string;
  tags: string[];
  is_test_record: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseRow {
  id: string;
  owner_id: string;
  client_id: string;
  title: string;
  category: string;
  description: string;
  organization: string;
  account_last4: string | null;
  status: CaseStatus;
  next_action: string;
  reminder_date: string | null;
  acting_for_another: boolean;
  authorization_on_file: boolean;
  authorization_notes: string;
  outcome: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseNoteRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string | null;
  session_date: string | null;
  body: string;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string | null;
  category: DocumentCategory;
  original_filename: string;
  storage_path: string;
  mime_type: "application/pdf" | "image/png" | "image/jpeg";
  size_bytes: number;
  sha256: string;
  page_count: number | null;
  description: string;
  created_at: string;
}

export interface TemplateRow {
  id: string;
  owner_id: string;
  name: string;
  letter_type: string;
  body: string;
  is_starter: boolean;
  created_at: string;
  updated_at: string;
}

export interface LetterRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string;
  title: string;
  letter_type: string;
  sender_address: Address;
  recipient_name: string;
  recipient_address: Address;
  body: string;
  mail_options: MailOptions;
  expects_response: boolean;
  status: LetterStatus;
  current_version: number;
  copied_from_packet_id: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LetterAttachmentRow {
  id: string;
  owner_id: string;
  client_id: string;
  letter_id: string;
  document_id: string;
  position: number;
  created_at: string;
}

export interface AttachmentSnapshot {
  document_id: string;
  original_filename: string;
  mime_type: string;
  sha256: string;
  position: number;
  page_count: number;
}

export interface LetterVersionRow {
  id: string;
  owner_id: string;
  client_id: string;
  letter_id: string;
  version_no: number;
  title: string;
  body: string;
  sender_address: Address;
  recipient_name: string;
  recipient_address: Address;
  attachments: AttachmentSnapshot[];
  content_hash: string;
  status: LetterStatus;
  created_at: string;
}

export interface PacketRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string;
  letter_id: string;
  letter_version_id: string;
  storage_path: string;
  pdf_sha256: string;
  packet_hash: string;
  page_count: number;
  sender_snapshot: Address;
  recipient_snapshot: Address;
  attachments_snapshot: AttachmentSnapshot[];
  mail_options: MailOptions;
  quote_cents: number | null;
  quote_currency: string | null;
  quote_source: string | null;
  quoted_at: string | null;
  is_test: boolean;
  status: PacketStatus;
  approved_at: string | null;
  approved_by: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
}

export interface MailingRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string;
  packet_id: string;
  idempotency_key: string;
  mail_mode: MailMode;
  provider: ProviderId;
  record_origin: RecordOrigin;
  service: string;
  return_receipt: boolean;
  recipient_snapshot: Address;
  page_count: number;
  mailing_status: MailingStatus;
  delivery_status: DeliveryStatus;
  response_status: ResponseStatus;
  provider_status_raw: string | null;
  provider_reference: string | null;
  tracking_number: string | null;
  tracking_supported: boolean;
  quote_cents: number | null;
  actual_cost_cents: number | null;
  cost_currency: string | null;
  awaiting_funding: boolean;
  submission_started_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  mailed_at: string | null;
  delivered_at: string | null;
  last_status_refresh_at: string | null;
  last_error: string | null;
  unresolved_condition: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailingEventRow {
  id: string;
  owner_id: string;
  client_id: string;
  mailing_id: string;
  source: EventSource;
  event_type: string;
  provider_status_raw: string | null;
  mailing_status: MailingStatus | null;
  delivery_status: DeliveryStatus | null;
  description: string;
  occurred_at: string | null;
  recorded_at: string;
  details: Record<string, unknown>;
}

export interface ResponseRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string;
  mailing_id: string | null;
  document_id: string | null;
  received_date: string;
  sender_name: string;
  notes: string;
  status: ResponseRecordStatus;
  next_action: string;
  follow_up_date: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRow {
  id: string;
  owner_id: string;
  client_id: string;
  case_id: string | null;
  mailing_id: string | null;
  response_id: string | null;
  kind: FollowUpKind;
  title: string;
  due_date: string;
  notes: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRow {
  id: string;
  owner_id: string;
  occurred_at: string;
  action: string;
  record_type: string;
  record_id: string | null;
  client_id: string | null;
  case_id: string | null;
  source: EventSource;
  actor_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export type VerificationStatus = "not_configured" | "configured_unverified" | "verified" | "failed";

export interface ProviderConnectionRow {
  id: string;
  owner_id: string;
  provider: "mock" | "letterstream";
  mode: MailMode;
  verification_status: VerificationStatus;
  last_verified_at: string | null;
  last_success_at: string | null;
  last_request_at: string | null;
  last_request_operation: string | null;
  last_response_status: string | null;
  last_error: string | null;
  last_status_sync_at: string | null;
  updated_at: string;
}

export interface ProviderApiLogRow {
  id: string;
  owner_id: string;
  provider: string;
  mode: MailMode;
  operation: string;
  outcome: "ok" | "error" | "timeout" | "blocked" | "unknown";
  http_status: number | null;
  message: string;
  mailing_id: string | null;
  created_at: string;
}

export interface Tables {
  clients: ClientRow;
  cases: CaseRow;
  case_notes: CaseNoteRow;
  documents: DocumentRow;
  templates: TemplateRow;
  letters: LetterRow;
  letter_attachments: LetterAttachmentRow;
  letter_versions: LetterVersionRow;
  mailing_packets: PacketRow;
  mailings: MailingRow;
  mailing_events: MailingEventRow;
  responses: ResponseRow;
  follow_ups: FollowUpRow;
  audit_events: AuditEventRow;
  provider_connections: ProviderConnectionRow;
  provider_api_log: ProviderApiLogRow;
}

export type TableName = keyof Tables;

type AutoColumns = "id" | "created_at" | "updated_at" | "recorded_at";
export type Insertable<T extends TableName> = Omit<Tables[T], AutoColumns> &
  Partial<Pick<Tables[T], Extract<keyof Tables[T], AutoColumns>>>;
export type Patch<T extends TableName> = Partial<Omit<Tables[T], "id" | "owner_id" | "created_at">>;
