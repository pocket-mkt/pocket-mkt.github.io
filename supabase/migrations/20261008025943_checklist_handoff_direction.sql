begin;
-- Requests have a direction, not a second campaign task or inferred historical owner.
alter table public.workspace_checklist add column request_direction text
 check(request_direction in ('POCKET_TO_NS','NS_TO_POCKET'));
comment on column public.workspace_checklist.request_direction is 'Receiving team determines UI color. Null preserves unassigned legacy requests.';
-- Optional field for already-open clients: omission preserves saved direction.
-- Existing authorization, row versions, actor stamping, retry IDs and audit remain intact.
create or replace function private.save_workspace_checklist(p_kind text,p_project_id bigint,p_id uuid,p_body jsonb,p_expected_version bigint,p_mutation_id uuid,p_operation text default 'SAVE') returns jsonb
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
   if not p_body ?& array['date','title','completed'] or (p_body - array['date','title','completed','direction']) <> '{}'::jsonb or jsonb_typeof(p_body->'title') is distinct from 'string' or jsonb_typeof(p_body->'date') is distinct from 'string' or jsonb_typeof(p_body->'completed') is distinct from 'boolean' then raise exception 'invalid_item' using errcode='22023'; end if;
   if length(trim(p_body->>'title')) not between 1 and 1000 or (p_body->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_item' using errcode='22023'; end if;
   if p_body ? 'direction' and (jsonb_typeof(p_body->'direction') is distinct from 'string' or p_body->>'direction' not in ('POCKET_TO_NS','NS_TO_POCKET')) then raise exception 'invalid_direction' using errcode='22023'; end if;
   done:=(p_body->>'completed')::boolean;
   if r.id is null then
    insert into public.workspace_checklist(id,project_id,task_date,title,completed_at,updated_by,request_direction)
    values(p_id,p_project_id,(p_body->>'date')::date,trim(p_body->>'title'),case when done then now() end,auth.uid(),p_body->>'direction') returning * into r;
   else
    update public.workspace_checklist set project_id=p_project_id,task_date=(p_body->>'date')::date,title=trim(p_body->>'title'),
     request_direction=coalesce(p_body->>'direction',request_direction),completed_at=case when done then coalesce(completed_at,now()) else null end,row_version=row_version+1,updated_at=now(),updated_by=auth.uid()
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


commit;
