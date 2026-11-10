-- 10 Nov 2026 — Smart Assistant (docs/LARA-SALES-AI-PLAN.md, phase 1).
-- Which features each person uses: ONE row per Cairo day, person and feature (a counter), never one row per click.
-- Read only by the edge function (service role), like every other table.
create table if not exists public.usage_feature_daily (
  day     date   not null,
  user_id uuid   not null,
  feature text   not null,
  uses    integer not null default 0,
  primary key (day, user_id, feature)
);
alter table public.usage_feature_daily enable row level security;
revoke all on public.usage_feature_daily from anon, authenticated;

create or replace function public.feature_hit(p_day date, p_user uuid, p_feature text)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_feature_daily (day, user_id, feature, uses) values (p_day, p_user, left(p_feature, 40), 1)
  on conflict (day, user_id, feature) do update set uses = public.usage_feature_daily.uses + 1;
$$;
revoke execute on function public.feature_hit(date, uuid, text) from public, anon, authenticated;
