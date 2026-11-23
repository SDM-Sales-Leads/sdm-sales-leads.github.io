-- 0034 (23 Nov 2026, Walid): offers, initial offers, offer history and demand were all test data before go-live.
-- ARCHIVED, not deleted: every row is copied to archive_test_offers_20261123 first, then removed from the live tables / lead timelines.
-- To restore: insert back from archive_test_offers_20261123 (payload holds the full original row or timeline entry).
begin;

create table if not exists public.archive_test_offers_20261123 (
  id          bigserial primary key,
  source      text not null,          -- crm_offer_prints | crm_lb_clicks | crm_lead_audit | lara_offer_files | lead_timeline | lead_assigned_plots
  ref         text,                   -- original id / lead id
  payload     jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.archive_test_offers_20261123 enable row level security;   -- no policies: server/owner only

insert into public.archive_test_offers_20261123 (source, ref, payload) select 'crm_offer_prints', id::text, to_jsonb(p) from public.crm_offer_prints p;
insert into public.archive_test_offers_20261123 (source, ref, payload) select 'crm_lb_clicks', id::text, to_jsonb(c) from public.crm_lb_clicks c;
insert into public.archive_test_offers_20261123 (source, ref, payload) select 'crm_lead_audit', id::text, to_jsonb(a) from public.crm_lead_audit a where a.action = 'offer';
insert into public.archive_test_offers_20261123 (source, ref, payload) select 'lara_offer_files', null, to_jsonb(f) from public.lara_offer_files f;
insert into public.archive_test_offers_20261123 (source, ref, payload)
  select 'lead_timeline', l.id::text, e from public.crm_leads l, jsonb_array_elements(l.data->'timeline') e
   where jsonb_typeof(l.data->'timeline') = 'array' and e->>'type' = 'Offer';
insert into public.archive_test_offers_20261123 (source, ref, payload)
  select 'lead_assigned_plots', l.id::text, l.data->'assignedPlots' from public.crm_leads l
   where jsonb_typeof(l.data->'assignedPlots') = 'array' and jsonb_array_length(l.data->'assignedPlots') > 0;

delete from public.crm_offer_prints;
delete from public.crm_lb_clicks;
delete from public.crm_lead_audit where action = 'offer';
delete from public.lara_offer_files;
update public.crm_leads l set data = jsonb_set(l.data, '{timeline}',
    coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(l.data->'timeline') with ordinality t(e, o) where e->>'type' is distinct from 'Offer'), '[]'::jsonb))
 where jsonb_typeof(l.data->'timeline') = 'array'
   and exists (select 1 from jsonb_array_elements(l.data->'timeline') e where e->>'type' = 'Offer');
update public.crm_leads set data = jsonb_set(data, '{assignedPlots}', '[]'::jsonb)
 where jsonb_typeof(data->'assignedPlots') = 'array' and jsonb_array_length(data->'assignedPlots') > 0;

commit;

select source, count(*) from public.archive_test_offers_20261123 group by 1 order by 1;
