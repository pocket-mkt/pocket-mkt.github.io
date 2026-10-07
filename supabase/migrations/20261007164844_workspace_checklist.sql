begin;
-- Meeting follow-ups are not campaign/Gantt tasks. One project FK, no copies.
create table public.workspace_checklist (
 id uuid primary key default gen_random_uuid(),
 project_id bigint not null references public.projects(id),
 task_date date not null check(task_date between '2000-01-01' and '2100-12-31'),
 title text not null check(length(trim(title)) between 1 and 1000),
 completed_at timestamptz,
 archived_at timestamptz,
 row_version bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);
create index workspace_checklist_project on public.workspace_checklist(project_id,task_date,id);
create index workspace_checklist_live_dates on public.workspace_checklist(task_date,id) where archived_at is null;
create index workspace_checklist_actor on public.workspace_checklist(updated_by);
create table public.project_checklist_boards (
 project_id bigint primary key references public.projects(id),
 body text not null check(length(body)<=10000),
 row_version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);
create index project_checklist_boards_actor on public.project_checklist_boards(updated_by);
create table private.checklist_audit (
 mutation_id uuid primary key,
 actor_id uuid not null references auth.users(id),
 project_id bigint not null references public.projects(id),
 kind text not null,
 request_hash text not null,
 before_value jsonb,
 response jsonb not null,
 occurred_at timestamptz not null default now()
);
create index checklist_audit_actor on private.checklist_audit(actor_id);
create index checklist_audit_project on private.checklist_audit(project_id,occurred_at desc);
alter table public.workspace_checklist enable row level security;
alter table public.project_checklist_boards enable row level security;
alter table private.checklist_audit enable row level security;
revoke all on public.workspace_checklist,public.project_checklist_boards,private.checklist_audit from public,anon,authenticated;
-- All access is through checked RPCs; even accidental future table grants deny.
create policy checklist_rpc_only on public.workspace_checklist as restrictive for all to authenticated using(false) with check(false);
create policy checklist_board_rpc_only on public.project_checklist_boards as restrictive for all to authenticated using(false) with check(false);
create policy checklist_audit_rpc_only on private.checklist_audit as restrictive for all to authenticated using(false) with check(false);

create function private.checklist_access(p bigint,writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.profiles u where u.id=auth.uid() and u.status_code='ACTIVE' and u.archived_at is null
  and ((u.organization_code='POCKET' and u.role_code in ('POCKET_MANAGER','POCKET_EDITOR')) or (u.organization_code='NS' and u.role_code='EXECUTOR_EDITOR'))
 ) and exists(select 1 from public.projects x where x.id=p and x.archived_at is null and x.status_code<>'DISABLED')
 and case when writing then private.can_write_page(p,'tasks') else private.can_read_project(p,'PROJECT_TEAM','tasks') end;
$$;
revoke all on function private.checklist_access(bigint,boolean) from public,anon,authenticated;

create function private.read_workspace_checklist(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare projects jsonb; items jsonb; cutoff timestamptz:=now()-interval '7 days'; n integer:=least(greatest(coalesce(p_limit,10),1),200);
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status_code='ACTIVE' and archived_at is null and organization_code in ('NS','POCKET') and role_code in ('POCKET_MANAGER','POCKET_EDITOR','EXECUTOR_EDITOR')) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_bucket is null or p_bucket not in ('active','completed') then raise exception 'invalid_bucket' using errcode='22023'; end if;
 if p_project_id is not null and not private.checklist_access(p_project_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or not p_cursor ?& array['date','id']) then raise exception 'invalid_cursor' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.project_name,'client_name',c.display_name,'canWrite',private.checklist_access(p.id,true)) order by c.display_name,p.id),'[]') into projects
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

create function private.read_checklist_board(p_project_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.checklist_access(p_project_id) then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object('item',(select to_jsonb(b) from public.project_checklist_boards b where project_id=p_project_id),'canWrite',private.checklist_access(p_project_id,true));
end $$;

create function private.save_workspace_checklist(p_kind text,p_project_id bigint,p_id uuid,p_body jsonb,p_expected_version bigint,p_mutation_id uuid,p_operation text default 'SAVE') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.workspace_checklist%rowtype; b public.project_checklist_boards%rowtype; a private.checklist_audit%rowtype; old jsonb; result jsonb; fingerprint text; done boolean;
begin
 if not private.checklist_access(p_project_id,true) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('ITEM','BOARD') or p_operation is null or p_operation not in ('SAVE','ARCHIVE') or p_mutation_id is null or p_body is null or jsonb_typeof(p_body)<>'object' then raise exception 'invalid_request' using errcode='22023'; end if;
 fingerprint:=md5(jsonb_build_array(p_kind,p_project_id,p_id,p_body,p_expected_version,p_operation)::text);
 perform pg_advisory_xact_lock(hashtextextended('checklist-mutation:'||p_mutation_id::text,0));
 select * into a from private.checklist_audit where mutation_id=p_mutation_id;
 if found then
  if a.actor_id is distinct from auth.uid() or a.request_hash<>fingerprint then raise exception 'mutation_reused' using errcode='22023'; end if;
  return a.response||jsonb_build_object('replayed',true);
 end if;
 if p_kind='ITEM' then
  if p_id is null then raise exception 'missing_id' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checklist-item:'||p_id::text,0));
  select * into r from public.workspace_checklist where id=p_id for update;
  if found and not private.checklist_access(r.project_id,true) then raise exception 'forbidden' using errcode='42501'; end if;
  if (r.id is null and p_expected_version is not null) or (r.id is not null and (p_expected_version is distinct from r.row_version or r.archived_at is not null)) then raise exception 'conflict' using errcode='40001'; end if;
  old:=case when r.id is null then null else to_jsonb(r) end;
  if p_operation='ARCHIVE' then
   if r.id is null then raise exception 'conflict' using errcode='40001'; end if;
   if r.project_id<>p_project_id then raise exception 'invalid_project' using errcode='22023'; end if;
   update public.workspace_checklist set archived_at=now(),row_version=row_version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into r;
  else
   if not p_body ?& array['date','title','completed'] or (select count(*) from jsonb_object_keys(p_body))<>3 or jsonb_typeof(p_body->'title') is distinct from 'string' or jsonb_typeof(p_body->'date') is distinct from 'string' or jsonb_typeof(p_body->'completed') is distinct from 'boolean' then raise exception 'invalid_item' using errcode='22023'; end if;
   if length(trim(p_body->>'title')) not between 1 and 1000 or (p_body->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_item' using errcode='22023'; end if;
   done:=(p_body->>'completed')::boolean;
   if r.id is null then
    insert into public.workspace_checklist(id,project_id,task_date,title,completed_at,updated_by)
    values(p_id,p_project_id,(p_body->>'date')::date,trim(p_body->>'title'),case when done then now() end,auth.uid()) returning * into r;
   else
    update public.workspace_checklist set project_id=p_project_id,task_date=(p_body->>'date')::date,title=trim(p_body->>'title'),
     completed_at=case when done then coalesce(completed_at,now()) else null end,row_version=row_version+1,updated_at=now(),updated_by=auth.uid()
    where id=p_id returning * into r;
   end if;
  end if;
  result:=jsonb_build_object('item',to_jsonb(r));
 else
  if p_id is not null or p_operation<>'SAVE' or jsonb_typeof(p_body->'text') is distinct from 'string' or (select count(*) from jsonb_object_keys(p_body))<>1 or length(p_body->>'text')>10000 then raise exception 'invalid_board' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checklist-board:'||p_project_id::text,0));
  select * into b from public.project_checklist_boards where project_id=p_project_id for update;
  if (b.project_id is null and p_expected_version is not null) or (b.project_id is not null and p_expected_version is distinct from b.row_version) then raise exception 'conflict' using errcode='40001'; end if;
  old:=case when b.project_id is null then null else to_jsonb(b) end;
  insert into public.project_checklist_boards(project_id,body,updated_by) values(p_project_id,p_body->>'text',auth.uid())
  on conflict(project_id) do update set body=excluded.body,row_version=public.project_checklist_boards.row_version+1,updated_at=now(),updated_by=auth.uid() returning * into b;
  result:=jsonb_build_object('item',to_jsonb(b));
 end if;
 insert into private.checklist_audit(mutation_id,actor_id,project_id,kind,request_hash,before_value,response)
 values(p_mutation_id,auth.uid(),p_project_id,p_kind,fingerprint,old,result);
 return result;
end $$;

create function public.read_workspace_checklist(p_project_id bigint default null,p_bucket text default 'active',p_cursor jsonb default null,p_limit integer default 10) returns jsonb language sql security invoker set search_path='' as $$select private.read_workspace_checklist(p_project_id,p_bucket,p_cursor,p_limit)$$;
create function public.read_checklist_board(p_project_id bigint) returns jsonb language sql security invoker set search_path='' as $$select private.read_checklist_board(p_project_id)$$;
create function public.save_workspace_checklist(p_kind text,p_project_id bigint,p_id uuid,p_body jsonb,p_expected_version bigint,p_mutation_id uuid,p_operation text default 'SAVE') returns jsonb language sql security invoker set search_path='' as $$select private.save_workspace_checklist(p_kind,p_project_id,p_id,p_body,p_expected_version,p_mutation_id,p_operation)$$;
revoke all on function private.read_workspace_checklist(bigint,text,jsonb,integer),private.read_checklist_board(bigint),private.save_workspace_checklist(text,bigint,uuid,jsonb,bigint,uuid,text),public.read_workspace_checklist(bigint,text,jsonb,integer),public.read_checklist_board(bigint),public.save_workspace_checklist(text,bigint,uuid,jsonb,bigint,uuid,text) from public,anon;
grant execute on function private.read_workspace_checklist(bigint,text,jsonb,integer),private.read_checklist_board(bigint),private.save_workspace_checklist(text,bigint,uuid,jsonb,bigint,uuid,text),public.read_workspace_checklist(bigint,text,jsonb,integer),public.read_checklist_board(bigint),public.save_workspace_checklist(text,bigint,uuid,jsonb,bigint,uuid,text) to authenticated;
commit;
