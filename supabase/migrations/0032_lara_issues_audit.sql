-- 0032 (22 Nov 2026): Lara issues tracker + video-call audit log (owner: "i need a log of issues and an audit log for her issues so
-- we can track it and fix the issues").
--  • lara_call_events: what happened in each video call, in order, with timings (call start, first sound, tools, face/voice
--    out of sync, clip load problems, connection drops, end). Written by the call page through the API (never directly).
--  • lara_issues: problems to fix. "auto" = raised from call events (the same problem on the same day adds to one row);
--    "staff" = reported by a person in Lara > Issues. Status: open -> investigating -> fixed / wontfix. Never deleted.

create table if not exists public.lara_call_events (
  id         bigint generated always as identity primary key,
  call_id    text not null,               -- one id per video call (made by the page)
  thread_id  uuid,
  lead_id    text,
  at         timestamptz not null default now(),
  t_ms       integer,                     -- milliseconds since the call started (browser clock)
  kind       text not null,               -- start, connected, first_audio, tool, interrupted, desync, clip_stall, ws_close, error, end ...
  data       jsonb not null default '{}'::jsonb
);
create index if not exists lara_call_events_call on public.lara_call_events (call_id, id);
create index if not exists lara_call_events_at on public.lara_call_events (at desc);

create table if not exists public.lara_issues (
  id         uuid primary key default gen_random_uuid(),
  source     text not null default 'auto' check (source in ('auto', 'staff')),
  kind       text not null,               -- desync, slow_start, clip_stall, connection, tool_error, language, lip_sync, other ...
  title      text not null,
  details    text,
  call_id    text,                        -- the latest call it was seen in
  thread_id  uuid,
  lead_id    text,
  count      integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  status     text not null default 'open' check (status in ('open', 'investigating', 'fixed', 'wontfix')),
  note       text,
  created_by text,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists lara_issues_status on public.lara_issues (status, last_seen desc);
create index if not exists lara_issues_auto on public.lara_issues (kind, status) where source = 'auto';

alter table public.lara_call_events enable row level security;
alter table public.lara_issues enable row level security;
revoke all on public.lara_call_events, public.lara_issues from anon, authenticated;
