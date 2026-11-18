-- 18 Nov 2026 — two safety changes (owner asked):
-- 1) AI daily cap is counted in ONE database step, so two questions at the same moment can never both pass the last free slot.
-- 2) Chat links expire: 90 days with no message, or 365 days after the link was made. A new Lara e-mail carries a fresh link.

-- 1) atomic AI counter (kept in system_config 'lara_ai_usage' = {"day":"YYYY-MM-DD","n":N}, Cairo day from the caller)
create or replace function public.lara_ai_take(p_day text, p_cap integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v jsonb; n integer;
begin
  if p_cap is null or p_cap <= 0 then return false; end if;
  insert into public.system_config (key, value, updated_at) values ('lara_ai_usage', jsonb_build_object('day', p_day, 'n', 0), now())
  on conflict (key) do nothing;
  select value into v from public.system_config where key = 'lara_ai_usage' for update;   -- row lock: one caller at a time
  n := case when v->>'day' = p_day then coalesce((v->>'n')::integer, 0) else 0 end;
  if n >= p_cap then return false; end if;
  update public.system_config set value = jsonb_build_object('day', p_day, 'n', n + 1), updated_at = now() where key = 'lara_ai_usage';
  return true;
end $$;
revoke all on function public.lara_ai_take(text, integer) from public, anon, authenticated;
grant execute on function public.lara_ai_take(text, integer) to service_role;

-- 2) when the chat link was made (existing links count from their last message, or from when the conversation started)
alter table public.lara_threads add column if not exists chat_key_at timestamptz;
update public.lara_threads set chat_key_at = coalesce(last_at, created_at, now()) where chat_key is not null and chat_key_at is null;
