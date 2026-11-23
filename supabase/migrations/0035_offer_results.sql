-- 0035 (23 Nov 2026, Walid): every printed offer gets a result.
--   open      printed, waiting for the customer
--   accepted  the customer accepted: the lead became Won (deal value = the offer total) and waits for finance to confirm the cash;
--             a hold request for the offer's plots is sent to the Land Bank (normal approval path)
--   rejected  the customer said no (reason required); the lead stays open
--   closed    another offer on the same lead was accepted
-- "Confirmed" is not stored here: it is the lead's cashStatus = confirmed (finance), shown next to an accepted offer.
alter table public.crm_offer_prints add column if not exists status text not null default 'open';
alter table public.crm_offer_prints drop constraint if exists crm_offer_prints_status_ck;
alter table public.crm_offer_prints add constraint crm_offer_prints_status_ck check (status in ('open','accepted','rejected','closed'));
alter table public.crm_offer_prints add column if not exists decided_at timestamptz;
alter table public.crm_offer_prints add column if not exists decided_by uuid;
alter table public.crm_offer_prints add column if not exists decided_by_name text;
alter table public.crm_offer_prints add column if not exists reject_reason text;
alter table public.crm_offer_prints add column if not exists decision_note text;
alter table public.crm_offer_prints add column if not exists lb_hold_req bigint;      -- Land Bank sid_status_req id of the hold request
alter table public.crm_offer_prints add column if not exists lb_hold_note text;       -- why no hold request was made (if any)
create index if not exists crm_offer_prints_lead_status_ix on public.crm_offer_prints (lead_id, status);
