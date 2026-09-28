-- AACTIVATED RX Task Scoreboard — Supabase setup
-- Run this once in your Supabase project: Dashboard → SQL Editor →
-- paste everything → Run. Then copy Project Settings → API →
-- "Project URL" and the "anon public" key into app/config.js (SUPABASE).

-- One row per task; the app keeps the task JSON in `body`.
create table if not exists public.tasks (
  id text primary key,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

-- Ticket counter, advanced atomically by next_ticket() below so two
-- devices creating at the same moment can never get the same number.
create table if not exists public.meta (
  key text primary key,
  value bigint not null
);

insert into public.meta (key, value)
values ('next_ticket', 1001)
on conflict (key) do nothing;

create or replace function public.next_ticket(p_floor bigint default 1001)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.meta
     set value = greatest(value, p_floor) + 1
   where key = 'next_ticket'
  returning value - 1;
$$;

-- Row-level security: the board is deliberately open to anyone holding
-- the anon key (i.e. anyone who can open the site) for these tables
-- only — keep the site link within the team.
alter table public.tasks enable row level security;
alter table public.meta enable row level security;

drop policy if exists "board read" on public.tasks;
drop policy if exists "board insert" on public.tasks;
drop policy if exists "board update" on public.tasks;
drop policy if exists "board delete" on public.tasks;

create policy "board read"   on public.tasks for select using (true);
create policy "board insert" on public.tasks for insert with check (true);
create policy "board update" on public.tasks for update using (true) with check (true);
create policy "board delete" on public.tasks for delete using (true);

-- meta has no direct policies: it is only touched through next_ticket(),
-- which runs as the function owner (security definer).
grant execute on function public.next_ticket(bigint) to anon;
