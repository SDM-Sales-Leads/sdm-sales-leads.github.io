-- 10 Nov 2026 — Lara phases 6 + 7. NO AI.
-- Phase 6 WhatsApp (Meta WhatsApp Cloud API, direct): one conversation per lead covers e-mail and WhatsApp; messages know their channel;
-- approved Meta templates are cached; consent and the 24-hour customer-service window are tracked per conversation.
-- Phase 7: autopilot per workflow (only when the owner switches Lara to Autopilot and lifts the test lock), Lara for sales users
-- (permission canUseLara: their own leads only).
alter table public.lara_threads  add column if not exists wa_phone     text;              -- digits, international (2010...)
alter table public.lara_threads  add column if not exists wa_last_in   timestamptz;       -- last customer WhatsApp message (24-hour window)
alter table public.lara_threads  add column if not exists wa_consent   text;              -- why we may message: enquiry / replied / opt-in
create index if not exists lara_threads_wa on public.lara_threads (wa_phone);
alter table public.lara_messages add column if not exists channel      text not null default 'email';
alter table public.lara_messages add column if not exists wa_id        text;              -- Meta message id (in or out)
alter table public.lara_messages add column if not exists wa_status    text;              -- sent / delivered / read / failed
create unique index if not exists lara_messages_wa_id on public.lara_messages (wa_id) where wa_id is not null;
alter table public.lara_drafts   add column if not exists wa_template  jsonb;             -- { name, lang, params[] } when outside the 24-hour window
alter table public.lara_drafts   add column if not exists to_phone     text;
alter table public.lara_workflows add column if not exists autopilot   boolean not null default false;

create table if not exists public.lara_wa_templates (
  name        text not null,
  lang        text not null,
  status      text not null default '',
  category    text not null default '',
  body        text not null default '',
  params      integer not null default 0,
  situation   text,                                      -- which Lara situation uses it outside the 24-hour window
  synced_at   timestamptz not null default now(),
  primary key (name, lang)
);
alter table public.lara_wa_templates enable row level security;
revoke all on public.lara_wa_templates from anon, authenticated;

-- the new permission exists for every role and is OFF (the owner switches it on per role when testing is finished)
update public.role_permissions set perms = coalesce(perms, '{}'::jsonb) || jsonb_build_object('canUseLara', false)
where not (coalesce(perms, '{}'::jsonb) ? 'canUseLara');
