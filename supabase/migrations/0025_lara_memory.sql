-- 11 Nov 2026 — Lara remembers each customer (rules, no AI) and never mixes customers.
-- memory: what this ONE conversation was about (parks, size, last question, last answer source, offer, hand-over), kept by the server on every
-- customer message; used to welcome a returning customer. It lives on the conversation of one lead, so one customer never sees another's history.
-- match_lead_id: a website visitor whose mobile/e-mail matches a lead. NOT joined automatically (anyone can type a number); staff confirm in Interactions.
alter table public.lara_threads add column if not exists memory        jsonb not null default '{}'::jsonb;
alter table public.lara_threads add column if not exists match_lead_id text;
alter table public.lara_threads add column if not exists started_by    text;    -- who handed the customer to Lara (null = Lara's own workflow)
