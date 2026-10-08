begin;
-- A projection of canonical tasks, not a copy or a second completion ledger.
create index activity_events_task_completion_lookup on public.activity_events(project_id,entity_id,created_at desc,id desc)
where entity_type='TASK' and event_status_code='COMMIT' and after_data->>'status_code'='DONE';

create function private.read_checklist_feed(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n integer:=least(greatest(coalesce(p_limit,10),1),200);
 today date:=(now() at time zone 'Asia/Seoul')::date; cutoff timestamptz:=now()-interval '7 days';
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status_code='ACTIVE' and archived_at is null and organization_code in ('NS','POCKET') and role_code in ('POCKET_MANAGER','POCKET_EDITOR','EXECUTOR_EDITOR')) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_project_id is not null and not private.checklist_access(p_project_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_bucket is null or p_bucket not in ('active','completed') then raise exception 'invalid_bucket' using errcode='22023'; end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or not p_cursor ?& array['date','id','completed'] or jsonb_typeof(p_cursor->'completed') is distinct from 'boolean' or jsonb_typeof(p_cursor->'date') is distinct from 'string' or jsonb_typeof(p_cursor->'id') is distinct from 'string') then raise exception 'invalid_cursor' using errcode='22023'; end if;
 with permitted as materialized (
  select p.id,coalesce(p.legacy_id,p.id::text) navigation_id,p.project_name name,c.display_name client_name,private.checklist_access(p.id,true) as "canWrite"
  from public.projects p join public.clients c on c.id=p.client_id where private.checklist_access(p.id)
 ), entries as materialized (
  select t.id::text id,'ITEM'::text row_kind,t.id::text source_id,t.project_id,t.task_date,t.title,t.completed_at,
   (t.completed_at is not null) is_complete,t.row_version,t.created_by,t.completed_by,
   null::text status_code,null::date execution_month
  from public.workspace_checklist t join permitted p on p.id=t.project_id
  where t.archived_at is null and (p_project_id is null or t.project_id=p_project_id)
  union all
  select 'task:'||t.id,'TASK',t.id::text,t.project_id,t.due_date,t.title,t.completed_at,
   t.status_code='DONE',t.row_version,t.created_by_user_id,null::uuid,
   private.effective_task_status(t.status_mode,t.status_code,t.planned_start_date,t.due_date,today),t.execution_month
  from public.tasks t join permitted p on p.id=t.project_id
  where t.archived_at is null and t.status_code<>'CANCELLED' and (p_project_id is null or t.project_id=p_project_id)
   and private.can_read_project(t.project_id,t.visibility_code,'tasks')
 ), page as materialized (
  select e.* from entries e
  where (case when p_bucket='completed' then e.is_complete and (e.completed_at is null or e.completed_at<=cutoff)
   else not e.is_complete or e.completed_at>cutoff end)
   and (p_cursor is null or (e.is_complete,coalesce(e.task_date,'9999-12-31'::date),e.id)>
    ((p_cursor->>'completed')::boolean,(p_cursor->>'date')::date,p_cursor->>'id'))
  order by e.is_complete,coalesce(e.task_date,'9999-12-31'::date),e.id limit n+1
 ), payload as (
  select e.*,creator.display_name created_by_name,completer.display_name completed_by_name
  from page e left join public.profiles creator on creator.id=e.created_by
  left join lateral (
   select a.actor_user_id from public.activity_events a
   where e.row_kind='TASK' and e.is_complete and a.project_id=e.project_id and a.entity_id=case when e.row_kind='TASK' then e.source_id::bigint end
    and a.entity_type='TASK' and a.event_status_code='COMMIT' and a.after_data->>'status_code'='DONE'
    and a.before_data->>'status_code' is distinct from 'DONE'
    and (a.after_data->>'completed_at')::timestamptz=e.completed_at
   order by a.created_at desc,a.id desc limit 1
  ) check_event on e.row_kind='TASK'
  left join public.profiles completer on completer.id=coalesce(e.completed_by,check_event.actor_user_id)
 )
 select jsonb_build_object('today',today,'as_of',now(),
  'projects',(select coalesce(jsonb_agg(to_jsonb(p) order by p.client_name,p.id),'[]') from permitted p),
  'summary',(select jsonb_build_object('pending',count(*) filter(where not is_complete),'overdue',count(*) filter(where not is_complete and task_date<today),'today',count(*) filter(where not is_complete and task_date=today)) from entries),
  'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.is_complete,coalesce(x.task_date,'9999-12-31'::date),x.id),'[]') from (select * from payload order by is_complete,coalesce(task_date,'9999-12-31'::date),id limit n) x),
  'next_cursor',case when (select count(*) from page)>n then
   (select jsonb_build_object('completed',is_complete,'date',coalesce(task_date,'9999-12-31'::date),'id',id) from page order by is_complete,coalesce(task_date,'9999-12-31'::date),id offset n-1 limit 1) else null end
 ) into result;
 return result;
end $$;
create function public.read_checklist_feed(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb
language sql security invoker set search_path='' as $$select private.read_checklist_feed(p_project_id,p_bucket,p_cursor,p_limit)$$;
revoke all on function private.read_checklist_feed(bigint,text,jsonb,integer),public.read_checklist_feed(bigint,text,jsonb,integer) from public,anon;
grant execute on function private.read_checklist_feed(bigint,text,jsonb,integer),public.read_checklist_feed(bigint,text,jsonb,integer) to authenticated;
commit;
