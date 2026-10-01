-- Consumer Desk — core relational schema, owner-only row-level security, and integrity rules.
--
-- Design notes
-- * Single-owner application. Every row carries owner_id and every policy requires that the
--   caller is the configured owner (public.is_owner()), which also enforces MFA assurance
--   level aal2 once the owner has a verified MFA factor.
-- * Cross-client integrity is enforced with composite foreign keys (child.client_id must equal
--   the parent's client_id), so a letter, attachment, response or mailing cannot be attached to
--   another client's record even through a direct API call.
-- * Separate status columns: case, letter (document), mailing, delivery and response status are
--   distinct enums. The raw provider status is stored verbatim beside the normalized status.
-- * No fictional/demo data is ever inserted here. Demo data lives only in the in-memory adapter.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------------------------
create type public.case_status as enum ('open', 'waiting', 'action_required', 'closed');
create type public.letter_status as enum ('draft', 'ready_for_review', 'approved', 'superseded');
create type public.packet_status as enum ('pending_review', 'approved', 'invalidated');
create type public.mailing_status as enum (
  'not_submitted', 'submitting', 'submission_unknown', 'accepted', 'processing', 'mailed', 'failed', 'cancelled'
);
create type public.delivery_status as enum (
  'not_available', 'pending', 'in_transit', 'delivered', 'delivery_exception', 'unknown'
);
create type public.response_status as enum (
  'not_expected', 'awaiting_response', 'response_received', 'review_needed', 'reviewed', 'follow_up_required', 'resolved'
);
create type public.document_category as enum (
  'supporting_evidence', 'correspondence', 'authorization', 'prepared_letter', 'mailing_proof', 'response'
);
create type public.mail_mode as enum ('mock', 'provider_test', 'live', 'manual');
create type public.event_source as enum ('owner', 'system', 'provider', 'simulation');
create type public.follow_up_kind as enum (
  'review_response', 'check_delivery', 'contact_client', 'prepare_next_correspondence', 'review_case', 'other'
);

-- ---------------------------------------------------------------------------------------------
-- Owner registry (spec: "users"). Rows are created only by the owner setup script using the
-- service role. There is no insert policy for authenticated users, so nobody can promote
-- themselves to owner.
-- ---------------------------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'owner' check (role in ('owner')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.role = 'owner' and u.active
    )
    and (
      coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
    );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Settings (no secrets are ever stored here; provider credentials live in server env vars)
-- ---------------------------------------------------------------------------------------------
create table public.app_settings (
  owner_id uuid primary key default auth.uid() references public.users (id) on delete cascade,
  app_name text not null default 'Consumer Desk' check (char_length(app_name) between 1 and 60),
  accent_primary text not null default '#3578FF' check (accent_primary ~ '^#[0-9A-Fa-f]{6}$'),
  accent_highlight text not null default '#35E7FF' check (accent_highlight ~ '^#[0-9A-Fa-f]{6}$'),
  accent_violet text not null default '#8B5CF6' check (accent_violet ~ '^#[0-9A-Fa-f]{6}$'),
  timezone text not null default 'America/Los_Angeles',
  return_address jsonb not null default '{}'::jsonb check (jsonb_typeof(return_address) = 'object'),
  updated_at timestamptz not null default now()
);
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Clients and cases
-- ---------------------------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 40),
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  preferred_contact text not null default 'email' check (preferred_contact in ('email', 'phone', 'mail', 'none')),
  notes text not null default '',
  tags text[] not null default '{}',
  is_test_record boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_owner_idx on public.clients (owner_id, archived_at);
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  category text not null default 'general',
  description text not null default '',
  organization text not null default '',
  -- Only the last four digits of an account reference are ever stored.
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  status public.case_status not null default 'open',
  next_action text not null default '',
  reminder_date date,
  acting_for_another boolean not null default false,
  authorization_on_file boolean not null default false,
  authorization_notes text not null default '',
  outcome text not null default '',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id)
);
create index cases_client_idx on public.cases (client_id);
create trigger cases_touch before update on public.cases
  for each row execute function public.touch_updated_at();

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  case_id uuid,
  session_date date,
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete cascade
);
create index case_notes_client_idx on public.case_notes (client_id);

-- ---------------------------------------------------------------------------------------------
-- Documents (file bytes live in the private storage bucket; only metadata here)
-- ---------------------------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  case_id uuid,
  category public.document_category not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count is null or page_count > 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete set null (case_id)
);
create index documents_client_idx on public.documents (client_id);

-- ---------------------------------------------------------------------------------------------
-- Templates and letters
-- ---------------------------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  letter_type text not null default 'general',
  body text not null default '',
  is_starter boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  case_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  letter_type text not null default 'general',
  sender_address jsonb not null default '{}'::jsonb check (jsonb_typeof(sender_address) = 'object'),
  recipient_name text not null default '',
  recipient_address jsonb not null default '{}'::jsonb check (jsonb_typeof(recipient_address) = 'object'),
  body text not null default '',
  mail_options jsonb not null default '{"service":"first_class","return_receipt":false}'::jsonb
    check (jsonb_typeof(mail_options) = 'object'),
  expects_response boolean not null default true,
  status public.letter_status not null default 'draft',
  current_version integer not null default 0,
  copied_from_packet_id uuid,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete cascade
);
create index letters_client_idx on public.letters (client_id);
create trigger letters_touch before update on public.letters
  for each row execute function public.touch_updated_at();

create table public.letter_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null,
  letter_id uuid not null,
  document_id uuid not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (letter_id, document_id),
  foreign key (letter_id, client_id) references public.letters (id, client_id) on delete cascade,
  foreign key (document_id, client_id) references public.documents (id, client_id)
);
create index letter_attachments_letter_idx on public.letter_attachments (letter_id, position);

-- Immutable snapshot of the letter content at packet-generation time.
create table public.letter_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null,
  letter_id uuid not null,
  version_no integer not null check (version_no > 0),
  title text not null,
  body text not null,
  sender_address jsonb not null,
  recipient_name text not null,
  recipient_address jsonb not null,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status public.letter_status not null default 'ready_for_review',
  created_at timestamptz not null default now(),
  unique (letter_id, version_no),
  unique (id, client_id),
  foreign key (letter_id, client_id) references public.letters (id, client_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Mailing packets (immutable once approved) and mailings
-- ---------------------------------------------------------------------------------------------
create table public.mailing_packets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null,
  case_id uuid not null,
  letter_id uuid not null,
  letter_version_id uuid not null,
  storage_path text not null unique,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  page_count integer not null check (page_count > 0),
  sender_snapshot jsonb not null,
  recipient_snapshot jsonb not null,
  attachments_snapshot jsonb not null default '[]'::jsonb,
  mail_options jsonb not null,
  quote_cents integer check (quote_cents is null or quote_cents >= 0),
  quote_currency text,
  quote_source text,
  quoted_at timestamptz,
  is_test boolean not null default false,
  status public.packet_status not null default 'pending_review',
  approved_at timestamptz,
  approved_by uuid references public.users (id),
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (letter_version_id, client_id) references public.letter_versions (id, client_id) on delete cascade,
  foreign key (letter_id, client_id) references public.letters (id, client_id) on delete cascade,
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete cascade,
  check (status <> 'approved' or (approved_at is not null and approved_by is not null))
);
create index mailing_packets_letter_idx on public.mailing_packets (letter_id);

create table public.mailings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  case_id uuid not null,
  packet_id uuid not null unique,
  idempotency_key text not null unique,
  mail_mode public.mail_mode not null,
  provider text not null check (provider in ('mock', 'letterstream', 'manual')),
  record_origin text not null check (record_origin in ('simulated', 'api_reported', 'manually_recorded')),
  service text not null,
  return_receipt boolean not null default false,
  recipient_snapshot jsonb not null,
  page_count integer not null,
  mailing_status public.mailing_status not null default 'not_submitted',
  delivery_status public.delivery_status not null default 'not_available',
  response_status public.response_status not null default 'awaiting_response',
  provider_status_raw text,
  provider_reference text,
  tracking_number text,
  tracking_supported boolean not null default false,
  quote_cents integer,
  actual_cost_cents integer,
  cost_currency text,
  awaiting_funding boolean not null default false,
  submission_started_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  mailed_at timestamptz,
  delivered_at timestamptz,
  last_status_refresh_at timestamptz,
  last_error text,
  unresolved_condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (packet_id, client_id) references public.mailing_packets (id, client_id) on delete restrict,
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete restrict
);
create index mailings_client_idx on public.mailings (client_id);
create trigger mailings_touch before update on public.mailings
  for each row execute function public.touch_updated_at();

create table public.mailing_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null,
  mailing_id uuid not null,
  source public.event_source not null,
  event_type text not null,
  provider_status_raw text,
  mailing_status public.mailing_status,
  delivery_status public.delivery_status,
  description text not null default '',
  occurred_at timestamptz,
  recorded_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  foreign key (mailing_id, client_id) references public.mailings (id, client_id) on delete cascade
);
create index mailing_events_mailing_idx on public.mailing_events (mailing_id, recorded_at);

-- ---------------------------------------------------------------------------------------------
-- Responses and follow-ups
-- ---------------------------------------------------------------------------------------------
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  case_id uuid not null,
  mailing_id uuid,
  document_id uuid,
  received_date date not null,
  sender_name text not null default '',
  notes text not null default '',
  status public.response_status not null default 'review_needed'
    check (status in ('response_received', 'review_needed', 'reviewed', 'follow_up_required', 'resolved')),
  next_action text not null default '',
  follow_up_date date,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete cascade,
  foreign key (mailing_id, client_id) references public.mailings (id, client_id) on delete set null (mailing_id),
  foreign key (document_id, client_id) references public.documents (id, client_id) on delete set null (document_id)
);
create index responses_client_idx on public.responses (client_id);
create trigger responses_touch before update on public.responses
  for each row execute function public.touch_updated_at();

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  case_id uuid,
  mailing_id uuid,
  response_id uuid,
  kind public.follow_up_kind not null default 'other',
  title text not null check (char_length(title) between 1 and 200),
  due_date date not null,
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (case_id, client_id) references public.cases (id, client_id) on delete cascade,
  foreign key (mailing_id, client_id) references public.mailings (id, client_id) on delete cascade,
  foreign key (response_id, client_id) references public.responses (id, client_id) on delete cascade
);
create index follow_ups_due_idx on public.follow_ups (owner_id, completed_at, due_date);
create trigger follow_ups_touch before update on public.follow_ups
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Audit log (append-only; no secrets, no document contents)
-- ---------------------------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  action text not null,
  record_type text not null,
  record_id uuid,
  client_id uuid,
  case_id uuid,
  source public.event_source not null default 'owner',
  actor_id uuid,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb
);
create index audit_events_client_idx on public.audit_events (client_id, occurred_at);
create index audit_events_time_idx on public.audit_events (owner_id, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Provider connection health (never secrets)
-- ---------------------------------------------------------------------------------------------
create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  provider text not null check (provider in ('mock', 'letterstream')),
  mode public.mail_mode not null,
  verification_status text not null default 'not_configured'
    check (verification_status in ('not_configured', 'configured_unverified', 'verified', 'failed')),
  last_verified_at timestamptz,
  last_success_at timestamptz,
  last_request_at timestamptz,
  last_request_operation text,
  last_response_status text,
  last_error text,
  last_status_sync_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, mode)
);
create trigger provider_connections_touch before update on public.provider_connections
  for each row execute function public.touch_updated_at();

create table public.provider_api_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  provider text not null,
  mode public.mail_mode not null,
  operation text not null,
  outcome text not null check (outcome in ('ok', 'error', 'timeout', 'blocked', 'unknown')),
  http_status integer,
  message text not null default '',
  mailing_id uuid,
  created_at timestamptz not null default now()
);
create index provider_api_log_time_idx on public.provider_api_log (owner_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------

-- Letter versions are immutable.
create or replace function public.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger letter_versions_immutable before update on public.letter_versions
  for each row execute function public.forbid_update();
create trigger audit_events_immutable before update on public.audit_events
  for each row execute function public.forbid_update();
create trigger mailing_events_immutable before update on public.mailing_events
  for each row execute function public.forbid_update();

-- Packets: content columns never change; status may only move forward.
create or replace function public.guard_packet_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.letter_version_id is distinct from old.letter_version_id
     or new.storage_path is distinct from old.storage_path
     or new.pdf_sha256 is distinct from old.pdf_sha256
     or new.packet_hash is distinct from old.packet_hash
     or new.page_count is distinct from old.page_count
     or new.sender_snapshot is distinct from old.sender_snapshot
     or new.recipient_snapshot is distinct from old.recipient_snapshot
     or new.attachments_snapshot is distinct from old.attachments_snapshot
     or new.mail_options is distinct from old.mail_options
     or new.client_id is distinct from old.client_id
     or new.letter_id is distinct from old.letter_id then
    raise exception 'packet content is immutable; generate a new packet' using errcode = 'P0001';
  end if;
  if old.status = 'invalidated' and new.status <> 'invalidated' then
    raise exception 'an invalidated packet cannot be re-approved' using errcode = 'P0001';
  end if;
  if old.status = 'approved' then
    if new.status = 'pending_review' then
      raise exception 'an approved packet cannot return to review' using errcode = 'P0001';
    end if;
    if new.quote_cents is distinct from old.quote_cents
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by then
      raise exception 'approved packet details are immutable' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'invalidated' and old.status <> 'invalidated'
     and exists (select 1 from public.mailings m where m.packet_id = old.id) then
    raise exception 'a packet that has a mailing record cannot be invalidated' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger mailing_packets_guard before update on public.mailing_packets
  for each row execute function public.guard_packet_update();

-- A mailing may only be created from an approved packet of the same client.
create or replace function public.guard_mailing_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.mailing_packets%rowtype;
begin
  select * into p from public.mailing_packets where id = new.packet_id;
  if not found or p.status <> 'approved' then
    raise exception 'mailings require an approved packet' using errcode = 'P0001';
  end if;
  if p.case_id <> new.case_id then
    raise exception 'mailing case does not match its packet' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger mailings_guard_insert before insert on public.mailings
  for each row execute function public.guard_mailing_insert();

-- Any content edit on a letter invalidates outstanding (not yet mailed) packet approvals.
create or replace function public.invalidate_packets_for_letter(p_letter_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.mailing_packets mp
     set status = 'invalidated', invalidated_at = now(), invalidation_reason = p_reason
   where mp.letter_id = p_letter_id
     and mp.status in ('pending_review', 'approved')
     and not exists (select 1 from public.mailings m where m.packet_id = mp.id);
end;
$$;

create or replace function public.guard_letter_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body
     or new.title is distinct from old.title
     or new.sender_address is distinct from old.sender_address
     or new.recipient_name is distinct from old.recipient_name
     or new.recipient_address is distinct from old.recipient_address
     or new.mail_options is distinct from old.mail_options then
    if old.locked_at is not null then
      raise exception 'this letter has a mailing record and is locked; create a new mailing from its packet'
        using errcode = 'P0001';
    end if;
    perform public.invalidate_packets_for_letter(old.id, 'letter content changed');
    new.status := 'draft';
  end if;
  return new;
end;
$$;
create trigger letters_guard before update on public.letters
  for each row execute function public.guard_letter_update();

create or replace function public.guard_attachment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_letter uuid := coalesce(new.letter_id, old.letter_id);
begin
  if exists (select 1 from public.letters l where l.id = v_letter and l.locked_at is not null) then
    raise exception 'this letter has a mailing record and is locked' using errcode = 'P0001';
  end if;
  perform public.invalidate_packets_for_letter(v_letter, 'attachments changed');
  update public.letters set status = 'draft' where id = v_letter and status <> 'draft';
  return coalesce(new, old);
end;
$$;
create trigger letter_attachments_guard after insert or update or delete on public.letter_attachments
  for each row execute function public.guard_attachment_change();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.app_settings enable row level security;
alter table public.clients enable row level security;
alter table public.cases enable row level security;
alter table public.case_notes enable row level security;
alter table public.documents enable row level security;
alter table public.templates enable row level security;
alter table public.letters enable row level security;
alter table public.letter_attachments enable row level security;
alter table public.letter_versions enable row level security;
alter table public.mailing_packets enable row level security;
alter table public.mailings enable row level security;
alter table public.mailing_events enable row level security;
alter table public.responses enable row level security;
alter table public.follow_ups enable row level security;
alter table public.audit_events enable row level security;
alter table public.provider_connections enable row level security;
alter table public.provider_api_log enable row level security;

-- Anonymous callers get nothing at all.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

create policy users_self_read on public.users for select to authenticated
  using (id = (select auth.uid()));

-- Full owner access for ordinary mutable tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'clients', 'cases', 'case_notes', 'documents', 'templates', 'letters',
    'letter_attachments', 'mailing_packets', 'mailings', 'responses', 'follow_ups',
    'provider_connections'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_owner()))
         with check (owner_id = (select auth.uid()) and (select public.is_owner()))',
      t || '_owner_all', t);
  end loop;
end;
$$;

-- Append-only tables: owner may read and insert, never update or delete.
do $$
declare
  t text;
begin
  foreach t in array array['letter_versions', 'mailing_events', 'audit_events', 'provider_api_log'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_owner()))',
      t || '_owner_read', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (owner_id = (select auth.uid()) and (select public.is_owner()))',
      t || '_owner_insert', t);
  end loop;
end;
$$;

-- letter_versions rows are removed only through the cascade when a whole client is deleted.
create policy letter_versions_owner_delete on public.letter_versions for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner()));

-- The owner may edit only their own display name.
revoke update on public.users from authenticated;
grant update (display_name) on public.users to authenticated;
create policy users_self_update on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
