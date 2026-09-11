-- Preserve already displayed hold intervals separately from editable dates.
set lock_timeout = '5s';
alter table public.tasks add column if not exists overdue_hold_ranges jsonb not null default '[]'::jsonb;

create or replace function private.preserve_task_hold_ranges()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  start_day date;
  end_day date;
  interval_item jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if tg_op='INSERT' then
    new.overdue_hold_ranges := '[]'::jsonb;
    return new;
  end if;
  -- Derived history cannot be overwritten through direct task fields.
  new.overdue_hold_ranges := old.overdue_hold_ranges;
  if old.status_code in ('ON_HOLD','BLOCKED') and (
    new.status_code not in ('ON_HOLD','BLOCKED') or
    new.schedule_dates is distinct from old.schedule_dates or
    new.planned_start_date is distinct from old.planned_start_date or
    new.due_date is distinct from old.due_date
  ) then
    start_day := old.due_date + 1;
    end_day := today;
  elsif old.overdue_hold_resolved_at is not null then
    -- Retain a legacy frozen trail before its dates or state are edited.
    start_day := old.due_date + 1;
    end_day := (old.overdue_hold_resolved_at at time zone 'Asia/Seoul')::date;
  end if;
  if start_day is not null and end_day >= start_day then
    interval_item := jsonb_build_object('startDate',start_day,'endDate',end_day);
    if not new.overdue_hold_ranges @> jsonb_build_array(interval_item) then
      new.overdue_hold_ranges := new.overdue_hold_ranges || jsonb_build_array(interval_item);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_task_hold_ranges() from public,anon,authenticated;
drop trigger if exists tasks_preserve_hold_ranges on public.tasks;
-- Alphabetically after tasks_normalize_schedule; sees final normalized status.
create trigger tasks_preserve_hold_ranges before insert or update on public.tasks
for each row execute function private.preserve_task_hold_ranges();

-- Extend only the existing safe projections; retain all permission checks/grants.
do $$
declare definition text; updated text; target regprocedure;
begin
  for target in select unnest(array[
    'private.read_tasks(bigint,boolean)'::regprocedure,
    'private.read_client_progress(bigint)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(target);
    updated := replace(definition,
      '''overdue_hold_resolved_at'', task.overdue_hold_resolved_at,',
      '''overdue_hold_resolved_at'', task.overdue_hold_resolved_at, ''overdue_hold_ranges'', task.overdue_hold_ranges,');
    updated := replace(updated,
      '''overdue_hold_resolved_at'', t.overdue_hold_resolved_at,',
      '''overdue_hold_resolved_at'', t.overdue_hold_resolved_at, ''overdue_hold_ranges'', t.overdue_hold_ranges,');
    if updated=definition then raise exception 'Hold projection anchor missing: %',target; end if;
    execute updated;
  end loop;
end;
$$;
reset lock_timeout;
