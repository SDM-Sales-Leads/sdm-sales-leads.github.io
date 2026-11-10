-- 11 Nov 2026 — Lara omnichannel: one Interactions inbox for e-mail, WhatsApp and web chat; chat with Lara from a button in her e-mails;
-- a summary on each conversation so the inbox reads ONE small row per conversation (no message download for the list).
-- Owner (11 Nov 2026): "cost efficient and performance efficient and fast in loading". NO AI here.

-- conversation summary, kept by a trigger (the inbox never counts messages on the fly)
alter table public.lara_threads add column if not exists chat_key      text;                 -- random key in the chat link (#k=...)
alter table public.lara_threads add column if not exists visitor       jsonb;                -- website chat without a lead: {name, phone, email}
alter table public.lara_threads add column if not exists last_at       timestamptz;
alter table public.lara_threads add column if not exists last_dir      text;
alter table public.lara_threads add column if not exists last_channel  text;
alter table public.lara_threads add column if not exists last_preview  text;
alter table public.lara_threads add column if not exists msg_count     integer not null default 0;
alter table public.lara_threads add column if not exists unread        integer not null default 0;   -- customer messages no staff member opened yet
alter table public.lara_threads add column if not exists channels      text[] not null default '{}';
create unique index if not exists lara_threads_chat_key on public.lara_threads (chat_key) where chat_key is not null;
create index if not exists lara_threads_last on public.lara_threads (last_at desc nulls last);

-- messages: chat and staff replies; who wrote an outgoing message
alter table public.lara_messages drop constraint if exists lara_messages_kind_check;
alter table public.lara_messages add constraint lara_messages_kind_check check (kind in ('mail', 'auto', 'unmatched', 'ignored', 'chat', 'staff'));
alter table public.lara_messages add column if not exists author text;     -- 'Lara', a staff member's name, or null for the customer
create index if not exists lara_messages_thread_at_desc on public.lara_messages (thread_id, at desc);

create or replace function public.lara_thread_summary() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.thread_id is null or new.kind in ('unmatched', 'ignored') then return new; end if;
  update public.lara_threads t set
    last_at = greatest(coalesce(t.last_at, new.at), new.at),
    last_dir = case when t.last_at is null or new.at >= t.last_at then new.direction else t.last_dir end,
    last_channel = case when t.last_at is null or new.at >= t.last_at then coalesce(new.channel, 'email') else t.last_channel end,
    last_preview = case when t.last_at is null or new.at >= t.last_at then left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 160) else t.last_preview end,
    msg_count = t.msg_count + 1,
    unread = t.unread + case when new.direction = 'in' and new.kind <> 'auto' then 1 else 0 end,
    channels = case when coalesce(new.channel, 'email') = any(t.channels) then t.channels else t.channels || coalesce(new.channel, 'email') end
  where t.id = new.thread_id;
  return new;
end $$;
drop trigger if exists lara_thread_summary on public.lara_messages;
create trigger lara_thread_summary after insert on public.lara_messages for each row execute function public.lara_thread_summary();

-- fill the summary for the conversations that exist today
update public.lara_threads t set
  last_at = s.last_at, last_dir = s.last_dir, last_channel = s.last_channel, last_preview = s.last_preview, msg_count = s.n, channels = s.chs
from (
  select m.thread_id, count(*)::int n, max(m.at) last_at,
         (array_agg(m.direction order by m.at desc))[1] last_dir,
         (array_agg(coalesce(m.channel, 'email') order by m.at desc))[1] last_channel,
         (array_agg(left(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'), 160) order by m.at desc))[1] last_preview,
         array_agg(distinct coalesce(m.channel, 'email')) chs
  from public.lara_messages m where m.thread_id is not null and m.kind not in ('unmatched', 'ignored') group by m.thread_id
) s where s.thread_id = t.id;
update public.lara_threads set last_at = coalesce(last_at, updated_at) where last_at is null;
