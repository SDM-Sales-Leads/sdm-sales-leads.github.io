-- 10 Nov 2026 — Lara workflows drawn as boxes and arrows (n8n-style). NO AI.
-- lara_workflows.graph = { nodes: [{id,type,x,y,data}], edges: [{id,source,target,handle?}] }. Empty = the old step list (converted on the fly,
-- with fixed ids t / w0 / s0 / … / end, so leads already running keep their place).
-- lara_enrollments.node = the box the lead is waiting at (null on old rows = mapped from `step`); wait_since = when a "Wait for a reply" began;
-- path = the boxes the lead went through (last 30), for the screen.
alter table public.lara_workflows   add column if not exists graph      jsonb;
alter table public.lara_enrollments add column if not exists node       text;
alter table public.lara_enrollments add column if not exists wait_since timestamptz;
alter table public.lara_enrollments add column if not exists path       jsonb not null default '[]'::jsonb;
