-- 24 Oct 2026: speed. The 5-minute reminder job filtered every lead by date fields inside the JSON; these indexes let it jump to the few rows.
-- Also the three foreign keys the performance advisor flagged, the change-time column the delta refresh reads, and a clean-up of the scheduler history.
create index if not exists crm_leads_nextfu_idx on public.crm_leads ((data->>'nextFollowUpDate')) where deleted_at is null and assigned_to is not null;
create index if not exists crm_leads_meeting_idx on public.crm_leads ((data->>'meetingDate')) where deleted_at is null and assigned_to is not null;
create index if not exists crm_leads_assigned_date_idx on public.crm_leads ((data->>'assignedDate')) where deleted_at is null and assigned_to is not null;
create index if not exists crm_tasks_due_idx on public.crm_tasks ((data->>'dueDate'));
create index if not exists crm_leads_created_by_idx on public.crm_leads (created_by) where created_by is not null;
create index if not exists app_users_team_leader_idx on public.app_users (team_leader_id) where team_leader_id is not null;
create index if not exists workflow_requests_created_by_idx on public.workflow_requests (created_by) where created_by is not null;
create index if not exists crm_contacts_updated_idx on public.crm_contacts (updated_at);
create index if not exists crm_companies_updated_idx on public.crm_companies (updated_at);
create index if not exists crm_tasks_updated_idx on public.crm_tasks (updated_at);
create index if not exists crm_activities_updated_idx on public.crm_activities (updated_at);
-- the scheduler keeps a row for every run (288 a day per job); keep three days
select cron.schedule('sdm-clean-cron-history', '30 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
