-- 0029 (19 Nov 2026): the company website (elsewedydevelopment.com, English + Arabic) as Lara's knowledge base. NO AI.
-- Every page is split into a tree (branch > page > heading > sub-heading) and each section into passages of ~700 chars.
-- Search never reads the whole site: it narrows by language and park, keeps passages that share a topic or a word with
-- the question (array indexes), scores them in the database and returns only the best few rows.
-- Loaded by scripts/site-kb (crawl.py + load.ts). Old rows are switched off (active = false), never deleted.

create table if not exists public.lara_site (
  id        bigint generated always as identity primary key,
  lang      text not null check (lang in ('en', 'ar')),
  branch    text not null,                -- Parks / Services & procedures / Company / Investing in Egypt / Case studies / News / Other
  park      text,                         -- canonical park name, null = about the company in general
  page      text not null,
  url       text not null,
  section   text not null,
  path      text not null,                -- "Industria October › Your Prime Location › Pioneering Industries › Logistics"
  body      text not null,
  terms     text[] not null default '{}', -- word stems (lara_match.analyse), for the search
  concepts  text[] not null default '{}', -- topics (price, utilities, location, documents ...)
  hterms    text[] not null default '{}', -- word stems of the heading path only (a heading says what the passage is about)
  pub_date  date,                         -- news only
  ord       integer not null default 0,
  batch     text not null,                -- one load = one batch
  active    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists lara_site_terms on public.lara_site using gin (terms) where active;
alter table public.lara_site add column if not exists hterms text[] not null default '{}';
create index if not exists lara_site_concepts on public.lara_site using gin (concepts) where active;
create index if not exists lara_site_lang_park on public.lara_site (lang, park) where active;
alter table public.lara_site enable row level security;
revoke all on public.lara_site from anon, authenticated;

-- best passages for a question: filter (language, park), narrow (shared topic or word), then score
drop function if exists public.lara_site_search(text, text[], text[], text[], integer);
create or replace function public.lara_site_search(p_lang text, p_parks text[], p_words text[], p_concepts text[], p_limit integer default 3)
returns table (id bigint, park text, branch text, page text, url text, path text, body text, w integer, c integer, h integer, score numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.park, s.branch, s.page, s.url, s.path, s.body, x.w, x.c, x.h,
         (x.w + 2.5 * x.h + 2.5 * x.c + case when s.park = any(coalesce(p_parks, '{}')) then 2 else 0 end
              + case s.branch when 'Parks' then 0.5 when 'Services & procedures' then 0.5 when 'News' then -1.5 when 'Investing in Egypt' then -1 else 0 end)::numeric as score
  from public.lara_site s
  cross join lateral (select (select count(*) from unnest(s.terms) t where t = any(p_words))::integer as w,
                             (select count(*) from unnest(s.concepts) k where k = any(p_concepts))::integer as c,
                             (select count(*) from unnest(s.hterms) t where t = any(p_words))::integer as h) x
  where s.active and s.lang = p_lang
    and (s.terms && coalesce(p_words, '{}') or s.concepts && coalesce(p_concepts, '{}'))
    and (coalesce(cardinality(p_parks), 0) = 0 or s.park is null or s.park = any(p_parks))
  order by score desc, s.ord
  limit least(greatest(coalesce(p_limit, 3), 1), 10)
$$;
revoke all on function public.lara_site_search(text, text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.lara_site_search(text, text[], text[], text[], integer) to service_role;

-- a suggested answer from the website for each missed question (the team checks it and saves it as the approved answer)
alter table public.lara_missed add column if not exists suggest jsonb;
