begin;
-- Preserve existing app navigation IDs while retaining canonical numeric write IDs.
create or replace function private.checklist_access(p bigint,writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.profiles u where u.id=auth.uid() and u.status_code='ACTIVE' and u.archived_at is null
  and ((u.organization_code='POCKET' and u.role_code in ('POCKET_MANAGER','POCKET_EDITOR')) or (u.organization_code='NS' and u.role_code='EXECUTOR_EDITOR'))
 ) and exists(select 1 from public.projects x join public.clients c on c.id=x.client_id where c.status_code='ACTIVE' and c.archived_at is null and x.id=p and x.archived_at is null and x.status_code<>'DISABLED')
 and case when writing then private.can_write_page(p,'tasks') else private.can_read_project(p,'PROJECT_TEAM','tasks') end;
$$;
create or replace function private.read_workspace_checklist(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare projects jsonb; items jsonb; cutoff timestamptz:=now()-interval '7 days'; n integer:=least(greatest(coalesce(p_limit,10),1),200);
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status_code='ACTIVE' and archived_at is null and organization_code in ('NS','POCKET') and role_code in ('POCKET_MANAGER','POCKET_EDITOR','EXECUTOR_EDITOR')) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_bucket is null or p_bucket not in ('active','completed') then raise exception 'invalid_bucket' using errcode='22023'; end if;
 if p_project_id is not null and not private.checklist_access(p_project_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or not p_cursor ?& array['date','id']) then raise exception 'invalid_cursor' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'navigation_id',coalesce(p.legacy_id,p.id::text),'name',p.project_name,'client_name',c.display_name,'canWrite',private.checklist_access(p.id,true)) order by c.display_name,p.id),'[]') into projects
 from public.projects p join public.clients c on c.id=p.client_id where private.checklist_access(p.id);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.task_date,x.id),'[]') into items from (
  select t.* from public.workspace_checklist t where t.archived_at is null and private.checklist_access(t.project_id)
  and (p_project_id is null or t.project_id=p_project_id)
  and (case when p_bucket='completed' then t.completed_at<=cutoff else t.completed_at is null or t.completed_at>cutoff end)
  and (p_cursor is null or (t.task_date,t.id)>((p_cursor->>'date')::date,(p_cursor->>'id')::uuid))
  order by t.task_date,t.id limit n+1
 ) x;
 return jsonb_build_object('projects',projects,'items',case when jsonb_array_length(items)>n then items-n else items end,
  'next_cursor',case when jsonb_array_length(items)>n then jsonb_build_object('date',items->(n-1)->>'task_date','id',items->(n-1)->>'id') else null end,'as_of',now());
end $$;
commit;
