-- Allow a manually held task to remain ON_HOLD after its scheduled due date.
-- When that hold is resolved, retain the resolution timestamp so the Gantt can
-- freeze the overdue segment instead of extending it forever.
alter table public.tasks
  add column if not exists status_mode text not null default 'SCHEDULE';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.tasks'::regclass
       and conname = 'tasks_status_mode_check'
  ) then
    alter table public.tasks
      add constraint tasks_status_mode_check
      check (status_mode in ('SCHEDULE', 'MANUAL'));
  end if;
end;
$$;

alter table public.tasks
  add column if not exists overdue_hold_resolved_at timestamptz;

comment on column public.tasks.overdue_hold_resolved_at is
  'When an overdue ON_HOLD task leaves hold, freezes the Gantt overdue segment at this timestamp.';

comment on column public.tasks.status_mode is
  'SCHEDULE derives status from planned dates; MANUAL preserves an explicit status until dates change. An overdue manual ON_HOLD state overrides automatic DONE.';

create or replace function private.effective_task_status(
  p_status_mode text,
  p_status_code text,
  p_start_date date,
  p_due_date date,
  p_today date
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    -- An explicit hold is the sole manual override that survives expiry.
    when coalesce(p_status_mode, 'SCHEDULE') = 'MANUAL'
      and coalesce(nullif(p_status_code, ''), 'NOT_STARTED') in ('ON_HOLD', 'BLOCKED') then 'ON_HOLD'
    when p_due_date is not null and p_today > p_due_date then 'DONE'
    when coalesce(p_status_mode, 'SCHEDULE') = 'MANUAL' then coalesce(nullif(p_status_code, ''), 'NOT_STARTED')
    when p_start_date is not null and p_today < p_start_date then 'NOT_STARTED'
    when p_start_date is not null
      and p_today >= p_start_date
      and (p_due_date is null or p_today <= p_due_date) then 'IN_PROGRESS'
    else coalesce(nullif(p_status_code, ''), 'NOT_STARTED')
  end;
$$;

revoke all on function private.effective_task_status(text, text, date, date, date)
  from public, anon, authenticated;

create or replace function private.normalize_task_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_dates date[];
  schedule_changed boolean := false;
  status_changed boolean := false;
  effective_status text;
  seoul_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if new.schedule_dates is not null then
    if cardinality(new.schedule_dates) = 0 then
      new.schedule_dates := array[]::date[];
      new.planned_start_date := null;
      new.due_date := null;
    else
      select array_agg(distinct day_value order by day_value)
        into normalized_dates
        from unnest(new.schedule_dates) as day_value;
      new.schedule_dates := normalized_dates;
      new.planned_start_date := normalized_dates[1];
      new.due_date := normalized_dates[cardinality(normalized_dates)];
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.status_mode := case
      when new.status_code in ('DONE', 'COMPLETED', 'ON_HOLD', 'BLOCKED') then 'MANUAL'
      else 'SCHEDULE'
    end;
    new.overdue_hold_resolved_at := null;
  else
    schedule_changed := new.schedule_dates is distinct from old.schedule_dates
      or new.planned_start_date is distinct from old.planned_start_date
      or new.due_date is distinct from old.due_date;
    status_changed := new.status_code is distinct from old.status_code;

    if schedule_changed then
      new.status_mode := 'SCHEDULE';
      new.overdue_hold_resolved_at := null;
    elsif status_changed then
      new.status_mode := 'MANUAL';
      if new.status_code in ('ON_HOLD', 'BLOCKED') then
        new.overdue_hold_resolved_at := null;
      elsif old.status_code in ('ON_HOLD', 'BLOCKED')
        and old.due_date is not null
        and seoul_today > old.due_date then
        new.overdue_hold_resolved_at := now();
      end if;
    else
      new.status_mode := coalesce(new.status_mode, old.status_mode, 'SCHEDULE');
      new.overdue_hold_resolved_at := old.overdue_hold_resolved_at;
    end if;

    if old.status_code = 'DONE' and new.status_code = 'DONE'
       and new.progress_percent is distinct from old.progress_percent
       and new.progress_percent < 100 then
      new.status_code := 'IN_PROGRESS';
      new.status_mode := 'MANUAL';
    elsif new.status_code <> 'DONE' and old.status_code = 'DONE' and new.progress_percent = 100 then
      new.progress_percent := 0;
    elsif new.status_code = 'NOT_STARTED' and old.status_code <> new.status_code then
      new.progress_percent := 0;
    end if;
  end if;

  effective_status := private.effective_task_status(
    new.status_mode,
    new.status_code,
    new.planned_start_date,
    new.due_date,
    seoul_today
  );
  new.status_code := effective_status;

  if new.status_code = 'DONE' then
    new.progress_percent := 100;
    if new.completed_at is null then new.completed_at := now(); end if;
  else
    if new.status_code = 'NOT_STARTED' and new.status_mode = 'SCHEDULE' then
      new.progress_percent := 0;
    end if;
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_task_schedule()
  from public, anon;

-- Keep the same project-scoped authorization and client projection while
-- exposing only the one new timeline timestamp required by read-only Gantt.
create or replace function private.read_tasks(
  p_project_id bigint,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_org text;
  result_items jsonb;
  result_members jsonb;
  result_project jsonb;
  result_total bigint;
  can_include_archived boolean := false;
  seoul_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select profile.organization_code
    into current_org
    from public.profiles profile
   where profile.id = current_user_id
     and profile.status_code = 'ACTIVE'
     and profile.archived_at is null;
  if current_org is null then
    raise exception 'inactive_profile' using errcode = '42501';
  end if;
  if not (select private.can_read_project(
    p_project_id,
    case when current_org = 'CLIENT' then 'CLIENT' else 'PROJECT_TEAM' end,
    'tasks'
  )) then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;
  can_include_archived := coalesce(p_include_archived, false)
    and (select private.can_write_page(p_project_id, 'tasks'));

  select count(*)
    into result_total
    from public.tasks task
   where task.project_id = p_project_id
     and (task.archived_at is null or can_include_archived)
     and (
       current_org = 'POCKET'
       or (current_org = 'NS' and task.visibility_code in ('PROJECT_TEAM', 'CLIENT'))
       or (current_org = 'CLIENT' and task.visibility_code = 'CLIENT')
     );

  select coalesce(jsonb_agg(
    case when current_org = 'CLIENT' then
      jsonb_build_object(
        'task_id', task.id,
        'project_id', task.project_id,
        'phase_code', task.phase_code,
        'workstream_code', task.workstream_code,
        'category_code', task.category_code,
        'title', task.title,
        'description', task.description,
        'responsible_org_code', 'POCKET',
        'status_mode', task.status_mode,
        'status_code', private.effective_task_status(task.status_mode, task.status_code, task.planned_start_date, task.due_date, seoul_today),
        'priority_code', task.priority_code,
        'planned_start_date', task.planned_start_date,
        'due_date', task.due_date,
        'schedule_dates_json', task.schedule_dates,
        'completed_at', task.completed_at,
        'overdue_hold_resolved_at', task.overdue_hold_resolved_at,
        'customer_status_text', task.customer_status_text,
        'progress_percent', case
          when private.effective_task_status(task.status_mode, task.status_code, task.planned_start_date, task.due_date, seoul_today) = 'DONE' then 100
          else task.progress_percent
        end,
        'completion_url', task.completion_url,
        'visibility_code', task.visibility_code,
        'sort_order', task.sort_order,
        'created_at', task.created_at,
        'updated_at', task.updated_at,
        'row_version', task.row_version
      )
    else
      to_jsonb(task)
        || jsonb_build_object(
          'task_id', task.id,
          'schedule_dates_json', task.schedule_dates,
          'status_code', private.effective_task_status(task.status_mode, task.status_code, task.planned_start_date, task.due_date, seoul_today),
          'progress_percent', case
            when private.effective_task_status(task.status_mode, task.status_code, task.planned_start_date, task.due_date, seoul_today) = 'DONE' then 100
            else task.progress_percent
          end
        )
    end
    order by task.sort_order, task.id
  ), '[]'::jsonb)
    into result_items
    from (
      select task.*
        from public.tasks task
       where task.project_id = p_project_id
         and (task.archived_at is null or can_include_archived)
         and (
           current_org = 'POCKET'
           or (current_org = 'NS' and task.visibility_code in ('PROJECT_TEAM', 'CLIENT'))
           or (current_org = 'CLIENT' and task.visibility_code = 'CLIENT')
         )
       order by task.sort_order, task.id
       limit 1000
    ) task;

  if current_org = 'CLIENT' then
    result_members := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', profile.id,
      'display_name', profile.display_name,
      'organization_code', profile.organization_code,
      'role_code', profile.role_code,
      'permission_code', membership.permission_code
    ) order by profile.display_name, profile.id), '[]'::jsonb)
      into result_members
      from public.project_memberships membership
      join public.profiles profile on profile.id = membership.user_id
     where membership.project_id = p_project_id
       and membership.status_code = 'ACTIVE'
       and membership.archived_at is null
       and profile.status_code = 'ACTIVE'
       and profile.archived_at is null;
  end if;

  select jsonb_build_object(
    'project_id', project.id,
    'phase_code', project.phase_code,
    'start_date', project.start_date,
    'end_date', project.end_date,
    'row_version', project.row_version
  )
    into result_project
    from public.projects project
   where project.id = p_project_id
     and project.archived_at is null;

  return jsonb_build_object(
    'items', result_items,
    'members', result_members,
    'totalMatching', result_total,
    'truncated', result_total > jsonb_array_length(result_items),
    'project', result_project
  );
end;
$$;

revoke all on function private.read_tasks(bigint, boolean)
  from public, anon, authenticated;
grant execute on function private.read_tasks(bigint, boolean)
  to authenticated, service_role;
