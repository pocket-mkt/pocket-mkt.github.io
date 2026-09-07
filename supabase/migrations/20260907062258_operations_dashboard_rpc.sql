-- Internal portfolio dashboard. One bounded RPC replaces one request per project.
create index if not exists project_issues_dashboard_idx
  on public.project_issues(project_id, status_code, due_date, issue_date desc)
  where archived_at is null;

create or replace function private.read_operations_dashboard(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile public.profiles%rowtype;
  seoul_today date := (now() at time zone 'Asia/Seoul')::date;
  range_from date;
  range_to date;
  result jsonb;
begin
  select * into caller_profile
    from public.profiles profile
   where profile.id = (select auth.uid())
     and profile.status_code = 'ACTIVE'
     and profile.archived_at is null;

  if caller_profile.id is null
     or caller_profile.organization_code not in ('POCKET', 'NS')
     or caller_profile.role_code not in ('POCKET_MANAGER', 'POCKET_EDITOR', 'EXECUTOR_EDITOR') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  range_from := coalesce(p_from, seoul_today - (extract(isodow from seoul_today)::integer - 1));
  range_to := coalesce(p_to, range_from + 6);
  if range_to < range_from or range_to - range_from > 62 then
    raise exception 'invalid_dashboard_range' using errcode = '22023';
  end if;

  with accessible_projects as materialized (
    select distinct project.id,
           project.client_id,
           client.display_name as client_name,
           project.project_name,
           project.status_code,
           project.phase_code,
           project.start_date,
           project.end_date
      from public.projects project
      join public.clients client on client.id = project.client_id
     where project.archived_at is null
       and project.status_code <> 'DISABLED'
       and client.archived_at is null
       and client.status_code = 'ACTIVE'
       and (
         caller_profile.role_code = 'POCKET_MANAGER'
         or exists (
           select 1
             from public.project_memberships membership
            where membership.project_id = project.id
              and membership.user_id = caller_profile.id
              and membership.status_code = 'ACTIVE'
              and membership.archived_at is null
         )
       )
  ), task_base as materialized (
    select task.*,
           private.effective_task_status(
             task.status_mode,
             task.status_code,
             task.planned_start_date,
             task.due_date,
             seoul_today
           ) as effective_status
      from public.tasks task
      join accessible_projects project on project.id = task.project_id
     where task.archived_at is null
       and task.visibility_code in ('PROJECT_TEAM', 'CLIENT')
  ), project_rollups as (
    select project.id as project_id,
           count(task.id)::integer as total_tasks,
           count(task.id) filter (where task.effective_status = 'DONE')::integer as done_tasks,
           count(task.id) filter (where task.effective_status = 'IN_PROGRESS')::integer as in_progress_tasks,
           count(task.id) filter (where task.effective_status in ('ON_HOLD', 'BLOCKED'))::integer as on_hold_tasks,
           count(task.id) filter (
             where task.due_date < seoul_today
               and task.effective_status <> 'DONE'
           )::integer as overdue_tasks,
           min(task.due_date) filter (
             where task.due_date >= seoul_today
               and task.effective_status <> 'DONE'
           ) as next_due_date
      from accessible_projects project
      left join task_base task on task.project_id = project.id
     group by project.id
  ), project_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', project.id,
      'client_id', project.client_id,
      'client_name', project.client_name,
      'project_name', project.project_name,
      'status_code', project.status_code,
      'phase_code', project.phase_code,
      'start_date', project.start_date,
      'end_date', project.end_date,
      'total_tasks', rollup.total_tasks,
      'done_tasks', rollup.done_tasks,
      'in_progress_tasks', rollup.in_progress_tasks,
      'on_hold_tasks', rollup.on_hold_tasks,
      'overdue_tasks', rollup.overdue_tasks,
      'next_due_date', rollup.next_due_date
    ) order by project.client_name, project.project_name), '[]'::jsonb) as value
      from accessible_projects project
      join project_rollups rollup on rollup.project_id = project.id
  ), weekly_task_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task_id', task.id,
      'project_id', project.id,
      'client_name', project.client_name,
      'project_name', project.project_name,
      'title', task.title,
      'description', task.description,
      'workstream_code', task.workstream_code,
      'responsible_org_code', task.responsible_org_code,
      'status_code', task.effective_status,
      'progress_percent', case when task.effective_status = 'DONE' then 100 else task.progress_percent end,
      'planned_start_date', task.planned_start_date,
      'due_date', task.due_date,
      'updated_at', task.updated_at
    ) order by coalesce(task.planned_start_date, task.due_date), task.sort_order, task.id), '[]'::jsonb) as value
      from task_base task
      join accessible_projects project on project.id = task.project_id
     where task.status_code <> 'CANCELLED'
       and task.planned_start_date is not null
       and task.due_date is not null
       and task.planned_start_date <= range_to
       and task.due_date >= range_from
  ), issue_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'issue_id', issue.id,
      'project_id', project.id,
      'client_name', project.client_name,
      'project_name', project.project_name,
      'issue_date', issue.issue_date,
      'due_date', issue.due_date,
      'kind_text', issue.kind_text,
      'related_task_text', issue.related_task_text,
      'body_text', issue.body_text,
      'owner_text', issue.owner_text,
      'status_code', issue.status_code,
      'updated_at', issue.updated_at
    ) order by issue.due_date nulls last, issue.issue_date desc, issue.id desc), '[]'::jsonb) as value
      from public.project_issues issue
      join accessible_projects project on project.id = issue.project_id
     where issue.archived_at is null
       and issue.visibility_code in ('PROJECT_TEAM', 'CLIENT')
       and issue.status_code <> 'DONE'
  ), meeting_json as (
    select coalesce(jsonb_agg(meeting_row.payload order by meeting_row.meeting_date desc, meeting_row.meeting_id desc), '[]'::jsonb) as value
      from (
        select meeting.meeting_date,
               meeting.id as meeting_id,
               jsonb_build_object(
                 'meeting_id', meeting.id,
                 'project_id', project.id,
                 'client_name', project.client_name,
                 'project_name', project.project_name,
                 'meeting_date', meeting.meeting_date,
                 'title', meeting.title,
                 'attendees_text', meeting.attendees_text,
                 'discussion_text', meeting.discussion_text,
                 'decisions_text', meeting.decisions_text,
                 'action_items_text', meeting.action_items_text,
                 'author_name', author.display_name,
                 'updated_at', meeting.updated_at
               ) as payload
          from public.daily_meetings meeting
          join accessible_projects project on project.id = meeting.project_id
          left join public.profiles author on author.id = meeting.created_by_user_id
         where meeting.archived_at is null
           and meeting.visibility_code in ('PROJECT_TEAM', 'CLIENT')
         order by meeting.meeting_date desc, meeting.id desc
         limit 60
      ) meeting_row
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', range_from, 'to', range_to),
    'generated_at', now(),
    'projects', project_json.value,
    'weekly_tasks', weekly_task_json.value,
    'issues', issue_json.value,
    'meetings', meeting_json.value
  ) into result
    from project_json, weekly_task_json, issue_json, meeting_json;

  return result;
end;
$$;

revoke all on function private.read_operations_dashboard(date, date)
  from public, anon;
grant execute on function private.read_operations_dashboard(date, date)
  to authenticated, service_role;

comment on function private.read_operations_dashboard(date, date) is
  'Internal-only, bounded portfolio dashboard for all projects visible to the signed-in Pocket or NS operator.';

create or replace function public.read_operations_dashboard(
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.read_operations_dashboard(p_from, p_to);
$$;

revoke all on function public.read_operations_dashboard(date, date)
  from public, anon;
grant execute on function public.read_operations_dashboard(date, date)
  to authenticated, service_role;
