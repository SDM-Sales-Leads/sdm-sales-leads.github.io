-- 11 Nov 2026 — a customer on the do-not-contact list who asks to hear from us again can be taken off it by an admin.
-- Nothing is deleted: the row stays with who removed it and when; a new "stop" puts it back (removed_at cleared).
alter table public.lara_optout add column if not exists removed_at timestamptz;
alter table public.lara_optout add column if not exists removed_by text;
