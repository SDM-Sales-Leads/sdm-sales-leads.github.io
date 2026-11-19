-- 0030 (19 Nov 2026): semantic search on the website knowledge base (owner: "Try free semantic search").
-- Each passage gets a meaning vector (Google gemini-embedding-001, 768 numbers, Arabic + English in one space), made ONCE when the
-- site is loaded. A question gets one vector; the database returns the passages closest in meaning, inside the park filter.
-- Without a key nothing breaks: Lara falls back to the word search of 0029.
create extension if not exists vector with schema extensions;

alter table public.lara_site add column if not exists embedding extensions.vector(768);
alter table public.lara_site add column if not exists emb_at timestamptz;

create or replace function public.lara_site_semantic(p_vec extensions.vector(768), p_lang text, p_parks text[], p_limit integer default 3)
returns table (id bigint, park text, branch text, page text, url text, path text, body text, ord integer, sim double precision)
language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.park, s.branch, s.page, s.url, s.path, s.body, s.ord, 1 - (s.embedding <=> p_vec) as sim
  from public.lara_site s
  where s.active and s.embedding is not null
    and (p_lang is null or s.lang = p_lang)
    and (coalesce(cardinality(p_parks), 0) = 0 or s.park is null or s.park = any(p_parks))
  order by s.embedding <=> p_vec
  limit least(greatest(coalesce(p_limit, 3), 1), 10)
$$;
revoke all on function public.lara_site_semantic(extensions.vector, text, text[], integer) from public, anon, authenticated;
grant execute on function public.lara_site_semantic(extensions.vector, text, text[], integer) to service_role;

-- passages still waiting for a vector (the embed job takes them in small batches)
create index if not exists lara_site_noemb on public.lara_site (id) where active and embedding is null;
