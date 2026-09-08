-- The persisted 'progress' grant now means the dedicated customer projection.
-- It must no longer authorize read_task_workspace (which includes issues).
create or replace function private.can_read_project(
  target_project_id bigint, row_visibility text default 'CLIENT', target_page text default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.is_pocket_manager()) or exists (
    select 1 from public.profiles profile
    join public.project_memberships membership
      on membership.user_id = profile.id and membership.project_id = target_project_id
    join public.projects project on project.id = membership.project_id
    where profile.id = (select auth.uid())
      and profile.status_code = 'ACTIVE' and profile.archived_at is null
      and membership.status_code = 'ACTIVE' and membership.archived_at is null
      and project.status_code <> 'DISABLED' and project.archived_at is null
      and (target_page is null or target_page = any(membership.allowed_pages))
      and (
        (profile.organization_code = 'CLIENT' and profile.role_code = 'CLIENT_VIEWER'
          and project.client_view_enabled and row_visibility = 'CLIENT')
        or (profile.organization_code = 'NS' and profile.role_code = 'EXECUTOR_EDITOR'
          and row_visibility in ('PROJECT_TEAM', 'CLIENT'))
        or (profile.organization_code = 'POCKET' and profile.role_code = 'POCKET_EDITOR')
      )
  );
$$;

create or replace function private.read_client_progress(p_project_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result_project jsonb;
  result_items jsonb;
  result_total bigint;
  seoul_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.status_code = 'ACTIVE' and p.archived_at is null
  ) then
    raise exception 'inactive_profile' using errcode = '42501';
  end if;
  if not ((select private.can_read_project(p_project_id, 'CLIENT', 'progress'))
       or (select private.can_read_project(p_project_id, 'CLIENT', 'tasks'))) then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;

  select jsonb_build_object('project_id', p.id, 'phase_code', p.phase_code,
    'start_date', p.start_date, 'end_date', p.end_date)
    into result_project from public.projects p
    where p.id = p_project_id and p.archived_at is null and p.status_code <> 'DISABLED';
  if result_project is null then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;

  select count(*) into result_total from public.tasks t
    where t.project_id = p_project_id and t.archived_at is null and t.visibility_code = 'CLIENT';
  -- Filter BEFORE the bound, for every role, including an internal preview.
  -- Explicit allowlist: never append to_jsonb(task), issues, meetings, or members.
  select coalesce(jsonb_agg(jsonb_build_object(
    'task_id', t.id, 'project_id', t.project_id,
    'phase_code', t.phase_code, 'workstream_code', t.workstream_code, 'category_code', t.category_code,
    'title', t.title, 'description', t.description,
    'status_mode', t.status_mode,
    'status_code', private.effective_task_status(t.status_mode, t.status_code, t.planned_start_date, t.due_date, seoul_today),
    'planned_start_date', t.planned_start_date, 'due_date', t.due_date,
    'schedule_dates_json', t.schedule_dates, 'completed_at', t.completed_at,
    'overdue_hold_resolved_at', t.overdue_hold_resolved_at,
    'progress_percent', case when private.effective_task_status(t.status_mode, t.status_code, t.planned_start_date, t.due_date, seoul_today) = 'DONE' then 100 else t.progress_percent end,
    'completion_url', t.completion_url, 'visibility_code', t.visibility_code,
    'sort_order', t.sort_order, 'created_at', t.created_at, 'updated_at', t.updated_at
  ) order by t.sort_order, t.id), '[]'::jsonb) into result_items
  from (
    select task.* from public.tasks task
      where task.project_id = p_project_id and task.archived_at is null and task.visibility_code = 'CLIENT'
      order by task.sort_order, task.id limit 1000
  ) t;
  return jsonb_build_object('audience', 'client-progress', 'items', result_items,
    'project', result_project, 'totalMatching', result_total,
    'truncated', result_total > jsonb_array_length(result_items));
end;
$$;

revoke all on function private.read_client_progress(bigint) from public, anon, authenticated;
grant execute on function private.read_client_progress(bigint) to authenticated, service_role;
create or replace function public.read_client_progress(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.read_client_progress(p_project_id);
$$;
revoke all on function public.read_client_progress(bigint) from public, anon, authenticated;
grant execute on function public.read_client_progress(bigint) to authenticated, service_role;
