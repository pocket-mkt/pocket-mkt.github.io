begin;
alter table public.workspace_checklist
 add column created_by uuid references auth.users(id),
 add column completed_by uuid references auth.users(id);
create index workspace_checklist_creator on public.workspace_checklist(created_by);
create index workspace_checklist_completer on public.workspace_checklist(completed_by);
create index workspace_checklist_triage on public.workspace_checklist((completed_at is not null),task_date,id) where archived_at is null;

-- Recover identities only from actual audit evidence, never the last editor.
update public.workspace_checklist t set created_by=(
 select a.actor_id from private.checklist_audit a where a.kind='ITEM'
 and a.response->'item'->>'id'=t.id::text and a.before_value is null
 order by a.occurred_at limit 1
),completed_by=case when t.completed_at is not null then (
 select a.actor_id from private.checklist_audit a where a.kind='ITEM'
 and a.response->'item'->>'id'=t.id::text
 and (a.response->'item'->>'completed_at')::timestamptz=t.completed_at
 and a.before_value->>'completed_at' is null
 order by a.occurred_at desc limit 1
) end;

create function private.stamp_checklist_actors() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.created_by:=auth.uid();
  new.completed_by:=case when new.completed_at is not null then auth.uid() end;
 else
  new.created_by:=old.created_by;
  new.completed_by:=case when new.completed_at is null then null
   when old.completed_at is null then auth.uid() else old.completed_by end;
 end if;
 return new;
end $$;
revoke all on function private.stamp_checklist_actors() from public,anon,authenticated;
create trigger checklist_actor_stamp before insert or update on public.workspace_checklist
for each row execute function private.stamp_checklist_actors();

create or replace function private.read_workspace_checklist(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare projects jsonb; items jsonb; summary jsonb; cursor_done boolean:=false;
 cutoff timestamptz:=now()-interval '7 days'; today date:=(now() at time zone 'Asia/Seoul')::date;
 n integer:=least(greatest(coalesce(p_limit,10),1),200);
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status_code='ACTIVE' and archived_at is null and organization_code in ('NS','POCKET') and role_code in ('POCKET_MANAGER','POCKET_EDITOR','EXECUTOR_EDITOR')) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_bucket is null or p_bucket not in ('active','completed') then raise exception 'invalid_bucket' using errcode='22023'; end if;
 if p_project_id is not null and not private.checklist_access(p_project_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or not p_cursor ?& array['date','id'] or
   (p_cursor ? 'completed' and jsonb_typeof(p_cursor->'completed') is distinct from 'boolean') then raise exception 'invalid_cursor' using errcode='22023'; end if;
  if p_cursor ? 'completed' then cursor_done:=(p_cursor->>'completed')::boolean;
  else -- Accept an already-open client's previous two-field cursor.
   select coalesce(bool_or(t.completed_at is not null),false) into cursor_done
   from public.workspace_checklist t where t.id=(p_cursor->>'id')::uuid and private.checklist_access(t.project_id);
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'navigation_id',coalesce(p.legacy_id,p.id::text),'name',p.project_name,'client_name',c.display_name,'canWrite',private.checklist_access(p.id,true)) order by c.display_name,p.id),'[]') into projects
 from public.projects p join public.clients c on c.id=p.client_id where private.checklist_access(p.id);
 select jsonb_build_object(
  'pending',count(*) filter(where t.completed_at is null),
  'overdue',count(*) filter(where t.completed_at is null and t.task_date<today),
  'today',count(*) filter(where t.completed_at is null and t.task_date=today)
 ) into summary from public.workspace_checklist t where t.archived_at is null and private.checklist_access(t.project_id)
 and (p_project_id is null or t.project_id=p_project_id);
 select coalesce(jsonb_agg(to_jsonb(x) order by (x.completed_at is not null),x.task_date,x.id),'[]') into items from (
  select t.*,creator.display_name as created_by_name,completer.display_name as completed_by_name
  from public.workspace_checklist t
  left join public.profiles creator on creator.id=t.created_by
  left join public.profiles completer on completer.id=t.completed_by
  where t.archived_at is null and private.checklist_access(t.project_id)
  and (p_project_id is null or t.project_id=p_project_id)
  and (case when p_bucket='completed' then t.completed_at<=cutoff else t.completed_at is null or t.completed_at>cutoff end)
  and (p_cursor is null or ((t.completed_at is not null),t.task_date,t.id)>(cursor_done,(p_cursor->>'date')::date,(p_cursor->>'id')::uuid))
  order by (t.completed_at is not null),t.task_date,t.id limit n+1
 ) x;
 return jsonb_build_object('projects',projects,'summary',summary,'today',today,
  'items',case when jsonb_array_length(items)>n then items-n else items end,
  'next_cursor',case when jsonb_array_length(items)>n then jsonb_build_object('completed',items->(n-1)->>'completed_at' is not null,'date',items->(n-1)->>'task_date','id',items->(n-1)->>'id') else null end,'as_of',now());
end $$;
commit;
