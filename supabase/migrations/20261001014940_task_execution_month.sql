set lock_timeout = '5s';
set statement_timeout = '30s';

begin;

alter table public.tasks add column execution_month date;

update public.tasks
   set execution_month = date_trunc(
     'month',
     coalesce(planned_start_date, due_date, created_at::date, (now() at time zone 'Asia/Seoul')::date)
   )::date
 where execution_month is null;

alter table public.tasks
  alter column execution_month set default date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date,
  alter column execution_month set not null;

alter table public.tasks add constraint tasks_execution_month_first_day_chk
  check (execution_month = date_trunc('month', execution_month)::date) not valid;
alter table public.tasks validate constraint tasks_execution_month_first_day_chk;

create index tasks_project_execution_month_idx
  on public.tasks(project_id, execution_month, sort_order, id)
  where archived_at is null;

comment on column public.tasks.execution_month is
  'First day of the execution-plan month. A task keeps this source month when it rolls over.';

-- Preserve the existing audited/version-checked write function and only add
-- the new allowlisted field to create/update paths.
do $$
declare src text; patched text;
begin
  src := pg_get_functiondef('private.mutate_task(text,text,bigint,bigint,bigint,jsonb)'::regprocedure);
  patched := replace(src,
    '''task_group_id'', ''task_group_name'', ''legacy_id'',',
    '''task_group_id'', ''task_group_name'', ''execution_month'', ''legacy_id'',');
  patched := replace(patched,
    'priority_code, planned_start_date, due_date, schedule_dates, blocker_reason,',
    'priority_code, execution_month, planned_start_date, due_date, schedule_dates, blocker_reason,');
  patched := replace(patched,
    'coalesce(nullif(p_fields ->> ''priority_code'', ''''), ''NORMAL''),
        nullif(p_fields ->> ''planned_start_date'', '''')::date,',
    'coalesce(nullif(p_fields ->> ''priority_code'', ''''), ''NORMAL''),
        coalesce(nullif(p_fields ->> ''execution_month'', '''')::date, date_trunc(''month'', coalesce(nullif(p_fields ->> ''planned_start_date'', '''')::date, (now() at time zone ''Asia/Seoul'')::date))::date),
        nullif(p_fields ->> ''planned_start_date'', '''')::date,');
  patched := replace(patched,
    'priority_code = case when p_fields ? ''priority_code'' then p_fields ->> ''priority_code'' else task.priority_code end,
          planned_start_date =',
    'priority_code = case when p_fields ? ''priority_code'' then p_fields ->> ''priority_code'' else task.priority_code end,
          execution_month = case when p_fields ? ''execution_month'' then nullif(p_fields ->> ''execution_month'', '''')::date else task.execution_month end,
          planned_start_date =');
  if patched = src
     or position('execution_month, planned_start_date' in patched) = 0
     or position('execution_month = case' in patched) = 0 then
    raise exception 'task_mutator_shape_changed';
  end if;
  execute patched;
end $$;

-- Add the month to the bounded internal and customer-safe projections without
-- widening any permission or exposing private task fields.
do $$
declare definition text; updated text; target regprocedure;
begin
  for target in select unnest(array[
    'private.read_tasks(bigint,boolean)'::regprocedure,
    'private.read_client_progress(bigint)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(target);
    updated := replace(definition,
      '''planned_start_date'', task.planned_start_date,',
      '''execution_month'', task.execution_month, ''planned_start_date'', task.planned_start_date,');
    updated := replace(updated,
      '''planned_start_date'', t.planned_start_date,',
      '''execution_month'', t.execution_month, ''planned_start_date'', t.planned_start_date,');
    if updated = definition then raise exception 'task_month_projection_shape_changed:%', target; end if;
    execute updated;
  end loop;
end $$;

-- The detailed task log shows month changes as a normal allowlisted field.
do $$
declare definition text; updated text; target regprocedure;
begin
  target := coalesce(
    to_regprocedure('private.read_task_activity(bigint,integer,timestamptz,bigint)'),
    to_regprocedure('private.read_task_activity(bigint,integer)')
  );
  definition := pg_get_functiondef(target);
  updated := replace(definition,
    '(''task_group_name'', ''task_group_name''), (''title'', ''title''),',
    '(''task_group_name'', ''task_group_name''), (''execution_month'', ''execution_month''), (''title'', ''title''),');
  if updated = definition then raise exception 'task_activity_month_shape_changed'; end if;
  execute updated;
end $$;

reset statement_timeout;
reset lock_timeout;

commit;
