-- 0033 (22 Nov 2026): one set of users for sdm-sales-leads AND sdm-land-bank (Walid).
-- sdm-sales-leads is where users are managed. Every minute /cron/authsync:
--   * creates the person's land bank login (same email, same password) with the mapped role/team,
--   * copies a changed password either way (only the bcrypt hash moves; never the clear password),
--   * blocks the land bank login of a person switched off here (never deletes).
-- Each system keeps its own login service, so one being down never stops sign-in to the other.
-- To stop the sync:   select cron.unschedule('sdm-authsync');

create table if not exists public.authsync_state (
  email       text primary key,           -- lower case
  fp          text,                       -- md5 of the password hash both systems had at the last sync
  profile_fp  text,                       -- md5 of the name/role/team/active last sent to the land bank
  last_error  text,
  synced_at   timestamptz not null default now()
);
alter table public.authsync_state enable row level security;   -- no policies: server only

create or replace function public.app_authsync_users()
returns table(email text, fp text, name text, role text, active boolean, leader_name text, leader_email text)
language sql stable security definer set search_path = public, auth as $$
  select lower(a.email), md5(coalesce(u.encrypted_password, '')), a.name, a.role, a.active, l.name, lower(l.email)
  from public.app_users a
  join auth.users u on u.id = a.id
  left join public.app_users l on l.id = a.team_leader_id $$;

create or replace function public.app_authsync_hash(p_email text) returns text
language sql stable security definer set search_path = public, auth as $$
  select encrypted_password from auth.users where lower(email) = lower(p_email) limit 1 $$;

create or replace function public.app_authsync_set_hash(p_email text, p_hash text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
begin
  if p_hash is null or p_hash !~ '^\$2[aby]\$[0-9]{2}\$.{53}$' then raise exception 'not a bcrypt hash'; end if;
  update auth.users set encrypted_password = p_hash, updated_at = now()
   where lower(email) = lower(p_email) and encrypted_password is distinct from p_hash;
  return found;
end $$;

revoke all on function public.app_authsync_users() from public, anon, authenticated;
revoke all on function public.app_authsync_hash(text) from public, anon, authenticated;
revoke all on function public.app_authsync_set_hash(text, text) from public, anon, authenticated;
grant execute on function public.app_authsync_users() to service_role;
grant execute on function public.app_authsync_hash(text) to service_role;
grant execute on function public.app_authsync_set_hash(text, text) to service_role;

-- the secret the land bank function checks back with us (created here, never shown, never copied anywhere)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sdm_authsync_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'sdm_authsync_secret');
  end if;
end $$;

select cron.unschedule('sdm-authsync') where exists (select 1 from cron.job where jobname = 'sdm-authsync');
select cron.schedule(
  'sdm-authsync',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://iyubegbevtjcvtuubpaq.supabase.co/functions/v1/api/cron/authsync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sdm_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $job$
);
