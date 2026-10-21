-- 21 Oct 2026: the usage meter counts in the database. Each request is served by a short-lived server copy, so counts kept in
-- memory were lost (93 calls counted in a month). One row per Cairo day and route, added to atomically on every answer.
create table if not exists public.usage_counter (
  day   date   not null,
  route text   not null,
  calls bigint not null default 0,
  bytes bigint not null default 0,
  primary key (day, route)
);
alter table public.usage_counter enable row level security;
revoke all on public.usage_counter from anon, authenticated;

create or replace function public.usage_hit(p_day date, p_route text, p_bytes bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_counter (day, route, calls, bytes) values (p_day, left(p_route, 60), 1, greatest(0, p_bytes))
  on conflict (day, route) do update set calls = public.usage_counter.calls + 1, bytes = public.usage_counter.bytes + excluded.bytes;
$$;
revoke execute on function public.usage_hit(date, text, bigint) from public, anon, authenticated;
