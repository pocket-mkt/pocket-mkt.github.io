-- Enrich the bounded operations dashboard payload with the progress increase
-- since the previous Seoul day closed. The existing dashboard reader remains
-- the authorization boundary and still performs the only task aggregation.
create function private.read_operations_dashboard_with_progress_delta(
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
  base_result jsonb;
  enriched_tasks jsonb;
  seoul_today date := (now() at time zone 'Asia/Seoul')::date;
  seoul_today_start timestamptz;
begin
  -- This function rejects unauthenticated or unauthorized callers before any
  -- audit rows are inspected, and returns only already-authorized task IDs.
  base_result := private.read_operations_dashboard(p_from, p_to);
  seoul_today_start := seoul_today::timestamp at time zone 'Asia/Seoul';

  with task_items as materialized (
    select item.value as payload,
           item.ordinality,
           (item.value ->> 'task_id')::bigint as task_id,
           (item.value ->> 'project_id')::bigint as project_id,
           greatest(0, least(100, coalesce(nullif(item.value ->> 'progress_percent', '')::integer, 0))) as current_progress
      from jsonb_array_elements(coalesce(base_result -> 'weekly_tasks', '[]'::jsonb))
        with ordinality as item(value, ordinality)
  ), daily_baselines as materialized (
    select distinct on (event.entity_id)
           event.entity_id as task_id,
           greatest(0, least(100, coalesce(nullif(event.before_data ->> 'progress_percent', '')::integer, 0))) as baseline_progress
      from public.activity_events event
      join task_items task
        on task.task_id = event.entity_id
       and task.project_id = event.project_id
     where event.entity_type = 'TASK'
       and event.event_status_code = 'COMMIT'
       and event.created_at >= seoul_today_start
       and event.created_at < seoul_today_start + interval '1 day'
       and event.before_data is not null
       and event.before_data -> 'progress_percent' is distinct from event.after_data -> 'progress_percent'
     order by event.entity_id, event.created_at, event.id
  )
  select coalesce(jsonb_agg(
    task.payload || jsonb_build_object(
      'progress_delta_today', greatest(0, task.current_progress - coalesce(baseline.baseline_progress, task.current_progress))
    ) order by task.ordinality
  ), '[]'::jsonb)
    into enriched_tasks
    from task_items task
    left join daily_baselines baseline on baseline.task_id = task.task_id;

  return jsonb_set(base_result, '{weekly_tasks}', enriched_tasks, true);
end;
$$;

revoke all on function private.read_operations_dashboard_with_progress_delta(date, date)
  from public, anon, authenticated;
grant execute on function private.read_operations_dashboard_with_progress_delta(date, date)
  to authenticated, service_role;

comment on function private.read_operations_dashboard_with_progress_delta(date, date) is
  'Authorized operations dashboard plus positive progress-point change since the previous Seoul day close.';

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
  select private.read_operations_dashboard_with_progress_delta(p_from, p_to);
$$;

revoke all on function public.read_operations_dashboard(date, date)
  from public, anon;
grant execute on function public.read_operations_dashboard(date, date)
  to authenticated, service_role;
