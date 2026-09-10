-- Completion is explicit; expiry signals DELAYED, never DONE.
-- No existing task rows/dates/history are rewritten by this migration.
set lock_timeout = '5s';
alter table public.tasks drop constraint if exists tasks_status_code_check;
alter table public.tasks add constraint tasks_status_code_check check (status_code in
 ('NOT_STARTED','IN_PROGRESS','DELAYED','INTERNAL_REVIEW','WAITING_CLIENT','REVISION','BLOCKED','ON_HOLD','DONE','CANCELLED'));

create or replace function private.effective_task_status(p_status_mode text, p_status_code text, p_start_date date, p_due_date date, p_today date)
returns text language sql immutable security invoker set search_path = '' as $$
 select case
  when p_status_code in ('DONE','COMPLETED') then 'DONE'
  when p_status_code in ('ON_HOLD','BLOCKED') then 'ON_HOLD'
  when p_status_code = 'CANCELLED' then 'CANCELLED'
  when p_due_date is not null and p_today > p_due_date then 'DELAYED'
  when coalesce(p_status_mode,'SCHEDULE') = 'MANUAL' then coalesce(nullif(p_status_code,''),'NOT_STARTED')
  when p_start_date is not null and p_today < p_start_date then 'NOT_STARTED'
  when p_start_date is not null and p_today >= p_start_date then 'IN_PROGRESS'
  else coalesce(nullif(p_status_code,''),'NOT_STARTED') end;
$$;
revoke all on function private.effective_task_status(text,text,date,date,date) from public,anon,authenticated;

create or replace function private.normalize_task_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
 normalized_dates date[];
 schedule_changed boolean := false;
 status_changed boolean := false;
 seoul_today date := (now() at time zone 'Asia/Seoul')::date;
begin
 if new.schedule_dates is not null then
  if cardinality(new.schedule_dates)=0 then
   new.schedule_dates := array[]::date[]; new.planned_start_date := null; new.due_date := null;
  else
   select array_agg(distinct day_value order by day_value) into normalized_dates from unnest(new.schedule_dates) day_value;
   new.schedule_dates := normalized_dates;
   new.planned_start_date := normalized_dates[1]; new.due_date := normalized_dates[cardinality(normalized_dates)];
  end if;
 end if;
 if tg_op='INSERT' then
  -- Keep scheduled starts for default tasks; explicit active/held/delayed/done stays manual.
  new.status_mode := case when new.status_code in ('IN_PROGRESS','DELAYED','DONE','ON_HOLD','BLOCKED','CANCELLED') then 'MANUAL' else 'SCHEDULE' end;
  new.overdue_hold_resolved_at := null;
 else
  schedule_changed := new.schedule_dates is distinct from old.schedule_dates or new.planned_start_date is distinct from old.planned_start_date or new.due_date is distinct from old.due_date;
  status_changed := new.status_code is distinct from old.status_code;
  if status_changed then new.status_mode := 'MANUAL';
  elsif schedule_changed and new.status_code not in ('DONE','ON_HOLD','BLOCKED','CANCELLED') then
   new.status_mode := 'SCHEDULE';
   if new.status_code='DELAYED' then new.status_code := 'NOT_STARTED'; end if;
  else new.status_mode := coalesce(new.status_mode,old.status_mode,'MANUAL'); end if;
  new.overdue_hold_resolved_at := old.overdue_hold_resolved_at;
  if schedule_changed or (status_changed and new.status_code in ('ON_HOLD','BLOCKED')) then
   new.overdue_hold_resolved_at := null;
  elsif status_changed and old.status_code in ('ON_HOLD','BLOCKED') and new.status_code='DONE' and old.due_date < seoul_today then
   new.overdue_hold_resolved_at := now();
  end if;
 end if;
 new.status_code := private.effective_task_status(new.status_mode,new.status_code,new.planned_start_date,new.due_date,seoul_today);
 -- Legacy percent storage retained for API compatibility, never drives status.
 if new.status_code='DONE' then
  new.progress_percent := 100;
  new.completed_at := coalesce(new.completed_at,now());
 else
  new.completed_at := null;
 end if;
 return new;
end;
$$;
revoke all on function private.normalize_task_schedule() from public,anon;
comment on column public.tasks.status_mode is 'MANUAL preserves explicit state; SCHEDULE derives start/in-progress. Expiry produces DELAYED, never completion. DONE and ON_HOLD survive date edits.';
reset lock_timeout;
