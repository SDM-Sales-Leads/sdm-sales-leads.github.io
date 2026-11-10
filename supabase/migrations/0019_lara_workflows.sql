-- 10 Nov 2026 — Lara Sales AI, phase 4: workflow builder. NO AI.
-- A workflow = WHEN (trigger) + IF (conditions) + THEN (steps with waits) + STOP (the salesperson acts, the customer replies, a meeting
-- is set). A lead in a workflow is an "enrollment" that moves one step at a time. Row security on, no browser policies.

create table if not exists public.lara_workflows (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  enabled     boolean not null default false,
  priority    integer not null default 100,           -- lower runs first; a lead is in one workflow at a time
  trigger     jsonb not null,                          -- { type, value, statuses? }
  conditions  jsonb not null default '[]'::jsonb,      -- [{ field, op, value }]
  steps       jsonb not null default '[]'::jsonb,      -- [{ waitDays, action, channel?, situation? }]
  stop        jsonb not null default '{"onActivity":true,"onReply":true,"onMeeting":true}'::jsonb,
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_by  text, updated_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.lara_enrollments (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.lara_workflows (id),
  lead_id       text not null,
  step          integer not null default 0,            -- the NEXT step to run
  status        text not null default 'active' check (status in ('active', 'done', 'stopped')),
  next_at       timestamptz not null default now(),
  why           text not null default '',
  stop_reason   text,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists lara_enroll_one_active on public.lara_enrollments (lead_id) where status = 'active';
create index if not exists lara_enroll_due on public.lara_enrollments (status, next_at);
create index if not exists lara_enroll_wf on public.lara_enrollments (workflow_id, status);

alter table public.lara_workflows   enable row level security;
alter table public.lara_enrollments enable row level security;
revoke all on public.lara_workflows, public.lara_enrollments from anon, authenticated;

-- six ready-made workflows (written by the Sales Director role). 1–5 replace Lara's fixed phase-2 rules; 6 is off until switched on.
insert into public.lara_workflows (name, description, enabled, priority, trigger, conditions, steps, created_by)
select * from (values
  ('New lead not contacted', 'A new lead with an owner and no first contact after 24 h: Lara introduces SDM, tries again after 3 days, then tells the owner.', true, 10,
    '{"type":"no_first_contact","value":24}'::jsonb, '[]'::jsonb,
    '[{"waitDays":0,"action":"message","channel":"auto","situation":"auto"},{"waitDays":3,"action":"message","channel":"auto","situation":"noanswer"},{"waitDays":3,"action":"notify_owner"}]'::jsonb, 'Setup'),
  ('Offer without follow-up', 'An offer was sent and nothing was logged for 3 days: Lara follows up, again after 4 days, then tells the owner.', true, 20,
    '{"type":"offer_silent","value":3}'::jsonb, '[]'::jsonb,
    '[{"waitDays":0,"action":"message","channel":"auto","situation":"auto"},{"waitDays":4,"action":"message","channel":"auto","situation":"offer"},{"waitDays":4,"action":"notify_owner"}]'::jsonb, 'Setup'),
  ('Follow-up overdue', 'The follow-up date passed 3 days ago: Lara writes once, and tells the owner if nothing happens in 3 days.', true, 30,
    '{"type":"followup_overdue","value":3}'::jsonb, '[]'::jsonb,
    '[{"waitDays":0,"action":"message","channel":"auto","situation":"auto"},{"waitDays":3,"action":"notify_owner"}]'::jsonb, 'Setup'),
  ('No answer: second and third try', '"No answer / Sent WhatsApp" and no new try for 2 days: Lara tries twice, then hands the lead back to the owner.', true, 40,
    '{"type":"no_answer","value":2}'::jsonb, '[]'::jsonb,
    '[{"waitDays":0,"action":"message","channel":"auto","situation":"auto"},{"waitDays":3,"action":"message","channel":"auto","situation":"noanswer_last"},{"waitDays":3,"action":"handover"}]'::jsonb, 'Setup'),
  ('Negotiation gone quiet', 'In Negotiation with no change for 7 days: tell the owner; after 3 more days tell the Sales Director. Lara does not write to the customer.', true, 50,
    '{"type":"status_stuck","value":7,"statuses":["Negotiation"]}'::jsonb, '[]'::jsonb,
    '[{"waitDays":0,"action":"notify_owner"},{"waitDays":3,"action":"notify_director"}]'::jsonb, 'Setup'),
  ('Wake up old leads', 'Old imported leads with an e-mail and no contact for 60 days: one friendly check-in. Off until you switch it on.', false, 90,
    '{"type":"old_lead","value":60}'::jsonb, '[{"field":"hasEmail","op":"is","value":true}]'::jsonb,
    '[{"waitDays":0,"action":"message","channel":"auto","situation":"cold"}]'::jsonb, 'Setup')
) as v(name, description, enabled, priority, trigger, conditions, steps, created_by)
where not exists (select 1 from public.lara_workflows);
