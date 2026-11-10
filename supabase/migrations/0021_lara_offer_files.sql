-- 10 Nov 2026 — Lara's Initial financial offer is built by the Land Bank page (same PDF as Investor Match, +20% customer price,
-- printed discount) and stored here until Lara attaches it. One file per offer draft; a rebuild overwrites it.
create table if not exists public.lara_offer_files (
  draft_id   uuid primary key references public.lara_drafts (id),
  file_name  text not null,
  pdf_b64    text not null,
  size_bytes integer not null,
  built_by   text,
  built_at   timestamptz not null default now()
);
alter table public.lara_offer_files enable row level security;
revoke all on public.lara_offer_files from anon, authenticated;
