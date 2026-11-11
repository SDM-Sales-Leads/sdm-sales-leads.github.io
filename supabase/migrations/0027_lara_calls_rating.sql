-- 11 Nov 2026 — Lara voice calls (browser speech now, Gemini Live later), call recording, customer rating.
-- A call's words are ordinary conversation messages (channel 'call'); this table keeps one row per call + where its recording is.
create table if not exists public.lara_calls (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.lara_threads (id),
  lead_id     text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null default now(),
  seconds     integer not null default 0,
  lang        text not null default 'ar',
  turns       integer not null default 0,
  audio_path  text,                 -- private storage bucket lara-calls (the customer's side; they are told and agree before the call)
  audio_bytes integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists lara_calls_thread on public.lara_calls (thread_id, started_at desc);
alter table public.lara_calls enable row level security;
revoke all on public.lara_calls from anon, authenticated;
alter table public.lara_threads add column if not exists rating      integer;      -- 1..5, the customer's last rating of Lara
alter table public.lara_threads add column if not exists rating_note text;
alter table public.lara_threads add column if not exists rating_at   timestamptz;
insert into storage.buckets (id, name, public) values ('lara-calls', 'lara-calls', false) on conflict (id) do nothing;
