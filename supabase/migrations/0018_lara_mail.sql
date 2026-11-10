-- 10 Nov 2026 — Lara Sales AI, phase 3: her own mailbox, "approve first" e-mail.
-- One conversation per lead, identified by a code in every subject Lara sends ("[SDM-LD-1234-7F3K]"), so a customer's reply joins the
-- right conversation and never becomes a duplicate lead. Row security on, no browser policies. Nothing is hard-deleted by the app.

create table if not exists public.lara_threads (
  id              uuid primary key default gen_random_uuid(),
  lead_id         text not null unique,
  code            text not null unique,                -- the subject code, e.g. SDM-LD-1234-7F3K
  customer_email  text not null default '',
  status          text not null default 'open' check (status in ('open', 'handover', 'stopped', 'closed')),
  out_count       integer not null default 0,
  unanswered      integer not null default 0,          -- Lara mails since the customer's last reply
  last_out_at     timestamptz,
  last_in_at      timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists lara_threads_email on public.lara_threads (lower(customer_email));

create table if not exists public.lara_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid references public.lara_threads (id),
  lead_id     text,
  direction   text not null check (direction in ('out', 'in')),
  kind        text not null default 'mail' check (kind in ('mail', 'auto', 'unmatched', 'ignored')),
  matched_by  text,                                     -- code | sender | lead | null
  subject     text not null default '',
  body        text not null default '',
  from_addr   text not null default '',
  to_addr     text not null default '',
  ews_id      text unique,                              -- Exchange item id of a received mail (read once)
  draft_id    uuid,
  at          timestamptz not null default now()
);
create index if not exists lara_messages_thread on public.lara_messages (thread_id, at);
create index if not exists lara_messages_unmatched on public.lara_messages (kind, at desc);

create table if not exists public.lara_optout (
  contact   text primary key,                           -- lower-case e-mail or phone digits
  reason    text not null default '',
  lead_id   text,
  by_who    text,
  at        timestamptz not null default now()
);

alter table public.lara_drafts add column if not exists kind text not null default 'followup';
alter table public.lara_drafts add column if not exists thread_id uuid;
alter table public.lara_drafts add column if not exists reply_to uuid;
alter table public.lara_drafts add column if not exists to_addr text;
alter table public.lara_drafts add column if not exists send_status text not null default 'none';
alter table public.lara_drafts add column if not exists send_error text;
alter table public.lara_drafts add column if not exists sent_at timestamptz;
do $$ begin
  alter table public.lara_drafts add constraint lara_drafts_send_status check (send_status in ('none', 'queued', 'sent', 'failed'));
exception when duplicate_object then null; end $$;
-- a reply draft may wait next to a follow-up draft of the same lead: only one OPEN follow-up per lead
drop index if exists public.lara_drafts_one_open;
create unique index if not exists lara_drafts_one_open on public.lara_drafts (lead_id) where status = 'shadow' and kind = 'followup';
create index if not exists lara_drafts_queue on public.lara_drafts (send_status) where send_status = 'queued';

alter table public.lara_threads  enable row level security;
alter table public.lara_messages enable row level security;
alter table public.lara_optout   enable row level security;
revoke all on public.lara_threads, public.lara_messages, public.lara_optout from anon, authenticated;
