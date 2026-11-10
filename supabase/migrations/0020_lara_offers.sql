-- 10 Nov 2026 — Lara Sales AI, phase 5: initial offers (PDF at list prices, approve first). The offer itself rides on the draft.
alter table public.lara_drafts add column if not exists offer jsonb;
create index if not exists lara_drafts_offers on public.lara_drafts (kind, created_at desc) where kind = 'offer';
