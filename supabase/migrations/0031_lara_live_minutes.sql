-- 0031 (20 Nov 2026): Lara video calls with Gemini Live — daily minute cap, counted atomically.
-- system_config 'lara_live_usage' = {"day":"YYYY-MM-DD","sec":N} (Cairo day from the caller). A call RESERVES its maximum length
-- when it starts (so two calls at once can never pass the cap) and gives back what it did not use when it ends.
create or replace function public.lara_live_take(p_day text, p_sec integer, p_cap_sec integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v jsonb; n integer;
begin
  if p_cap_sec is null or p_cap_sec <= 0 or p_sec is null or p_sec <= 0 then return false; end if;
  insert into public.system_config (key, value, updated_at) values ('lara_live_usage', jsonb_build_object('day', p_day, 'sec', 0), now())
  on conflict (key) do nothing;
  select value into v from public.system_config where key = 'lara_live_usage' for update;
  n := case when v->>'day' = p_day then coalesce((v->>'sec')::integer, 0) else 0 end;
  if n + p_sec > p_cap_sec then return false; end if;
  update public.system_config set value = jsonb_build_object('day', p_day, 'sec', n + p_sec), updated_at = now() where key = 'lara_live_usage';
  return true;
end $$;

create or replace function public.lara_live_give(p_day text, p_sec integer) returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb; n integer;
begin
  if p_sec is null or p_sec <= 0 then return; end if;
  select value into v from public.system_config where key = 'lara_live_usage' for update;
  if v is null or v->>'day' <> p_day then return; end if;
  n := greatest(0, coalesce((v->>'sec')::integer, 0) - p_sec);
  update public.system_config set value = jsonb_build_object('day', p_day, 'sec', n), updated_at = now() where key = 'lara_live_usage';
end $$;

revoke all on function public.lara_live_take(text, integer, integer) from public, anon, authenticated;
revoke all on function public.lara_live_give(text, integer) from public, anon, authenticated;
grant execute on function public.lara_live_take(text, integer, integer) to service_role;
grant execute on function public.lara_live_give(text, integer) to service_role;
