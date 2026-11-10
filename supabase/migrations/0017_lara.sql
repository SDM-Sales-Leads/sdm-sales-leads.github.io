-- 10 Nov 2026 — Lara Sales AI, phase 2 (docs/LARA-SALES-AI-PLAN.md): foundation in SHADOW mode.
-- Lara writes drafts for leads the team did not follow up; nothing is sent. Answers come from an approved Q&A (no AI).
-- All tables: row security on, no browser policies (only the edge function, as everywhere). Nothing is ever hard-deleted by the app:
-- Q&A rows are archived, drafts expire, questions are dismissed.

create table if not exists public.lara_kb (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null default 'General',
  q_ar        text not null default '',
  q_en        text not null default '',
  phrasings   text not null default '',          -- other ways customers ask it, one per line
  a_ar        text not null default '',
  a_en        text not null default '',
  status      text not null default 'active' check (status in ('active', 'archived')),
  uses        integer not null default 0,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.lara_missed (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  lang        text not null default 'ar',
  source      text not null default 'test' check (source in ('seed', 'test', 'customer')),
  lead_id     text,
  asked       integer not null default 1,
  status      text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  kb_id       uuid references public.lara_kb (id),
  decided_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lara_missed_open on public.lara_missed (status, created_at desc);

create table if not exists public.lara_drafts (
  id          uuid primary key default gen_random_uuid(),
  lead_id     text not null,
  run_id      text,
  rule        text not null,                      -- why Lara picked this lead
  situation   text not null,
  channel     text not null check (channel in ('whatsapp', 'email')),
  lang        text not null default 'ar',
  subject     text not null default '',
  body        text not null,
  reason      text not null default '',
  customer    text not null default '',
  owner_id    text,
  owner_name  text,
  status      text not null default 'shadow' check (status in ('shadow', 'approved', 'rejected', 'expired')),
  feedback    text,
  edited      boolean not null default false,
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lara_drafts_one_open on public.lara_drafts (lead_id) where status = 'shadow';
create index if not exists lara_drafts_recent on public.lara_drafts (status, created_at desc);

create table if not exists public.lara_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  kind    text not null,
  actor   text,
  text    text not null default '',
  data    jsonb
);
create index if not exists lara_log_at on public.lara_log (at desc);

alter table public.lara_kb     enable row level security;
alter table public.lara_missed enable row level security;
alter table public.lara_drafts enable row level security;
alter table public.lara_log    enable row level security;
revoke all on public.lara_kb, public.lara_missed, public.lara_drafts, public.lara_log from anon, authenticated;
revoke all on sequence public.lara_log_id_seq from anon, authenticated;

-- Starter questions customers ask (written by the Sales Director role). They have NO answers on purpose: SDM's real facts
-- (prices, payment plans, utilities, licences) must come from the company. The admin answers each once; it then joins the Q&A.
insert into public.lara_missed (question, lang, source)
select q, 'ar', 'seed' from (values
  ('سعر المتر كام في المشروع؟'),
  ('فيه تقسيط؟ وإيه أنظمة السداد المتاحة؟'),
  ('المقدم كام في المية؟'),
  ('مدة التقسيط أقصى حاجة كام سنة؟'),
  ('الأرض متوصل لها كهربا؟ والقدرة المتاحة كام؟'),
  ('فيه مياه وصرف صناعي وغاز طبيعي؟'),
  ('الاستلام إمتى بعد التعاقد؟'),
  ('إيه الأوراق المطلوبة للحجز؟'),
  ('مبلغ الحجز كام؟ وهل بيترد لو لغيت؟'),
  ('إيه أقل مساحة ممكن أشتريها؟'),
  ('ينفع أجمع أكتر من قطعة جنب بعض؟'),
  ('نسبة البناء المسموحة والارتفاع كام؟'),
  ('الترخيص بيطلع منين؟ وهل بتساعدونا في التراخيص؟'),
  ('هل فيه رخصة ذهبية أو حوافز ضريبية؟'),
  ('فيه مصانع أو مخازن جاهزة للإيجار؟'),
  ('ينفع إيجار بدل شراء؟'),
  ('الأجانب ينفع يشتروا؟'),
  ('إيه الأنشطة المسموحة في المنطقة؟'),
  ('رسوم الصيانة والخدمات السنوية كام؟'),
  ('المسافة من الموقع لأقرب ميناء وطريق رئيسي؟'),
  ('فيه مواصلات للعمال وسكن قريب؟'),
  ('الأمن والحماية المدنية في المنطقة إزاي؟'),
  ('العقد بيتسجل؟ والتسجيل بيتعمل إزاي؟'),
  ('ينفع أعمل زيارة للموقع؟ وإزاي أحجز ميعاد؟'),
  ('هل فيه خصم على الكاش؟')
) as t(q)
where not exists (select 1 from public.lara_missed where source = 'seed');
