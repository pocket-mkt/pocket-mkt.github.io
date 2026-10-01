-- Production migration version: 20261001095153.
-- Shared operations, not administrator promotion. Never broaden project RLS
-- or expose Pocket-only content when granting customer hide/show controls.
do $migration$
declare definition text; old_guard text; new_guard text;
begin
  definition := pg_get_functiondef('private.mutate_task(text,text,bigint,bigint,bigint,jsonb)'::regprocedure);
  old_guard := $guard$if current_org = 'NS'
        and p_fields ? 'visibility_code'
        and nullif(p_fields ->> 'visibility_code', '') is distinct from task_row.visibility_code then$guard$;
  new_guard := $guard$if current_org = 'NS'
        and p_fields ? 'visibility_code'
        and coalesce(nullif(p_fields ->> 'visibility_code', ''), '') not in ('PROJECT_TEAM','CLIENT') then$guard$;
  if position(old_guard in definition)=0 then raise exception 'task visibility guard drift'; end if;
  definition := replace(definition,old_guard,new_guard);
  old_guard := 'if task_row.row_version <> p_expected_row_version then';
  if position(old_guard in definition)=0 then raise exception 'task row guard drift'; end if;
  definition := replace(definition,old_guard,$guard$if not private.can_read_project(p_project_id,task_row.visibility_code,'tasks') then
        raise exception 'forbidden_task' using errcode='42501';
      end if;
      if task_row.row_version <> p_expected_row_version then$guard$);
  execute definition;

  definition := pg_get_functiondef('public.mutate_daily_meeting(text,text,bigint,bigint,bigint,jsonb)'::regprocedure);
  old_guard := $guard$coalesce(nullif(p_fields->>'visibility_code',''),'PROJECT_TEAM') <> 'PROJECT_TEAM'$guard$;
  if position(old_guard in definition)=0 then raise exception 'meeting visibility guard drift'; end if;
  definition := replace(definition,old_guard,$guard$coalesce(nullif(p_fields->>'visibility_code',''),'PROJECT_TEAM') not in ('PROJECT_TEAM','CLIENT')$guard$);
  old_guard := 'if meeting_row.row_version <> p_expected_row_version then';
  if position(old_guard in definition)=0 then raise exception 'meeting row guard drift'; end if;
  definition := replace(definition,old_guard,$guard$if not private.can_read_project(p_project_id,meeting_row.visibility_code,'daily') then raise exception 'forbidden_meeting' using errcode='42501'; end if;
      if meeting_row.row_version <> p_expected_row_version then$guard$);
  execute definition;
end $migration$;

-- The old start-date editor wrote to Sheets while the schedule reads Supabase.
-- A narrow audited RPC avoids granting NS arbitrary project administration.
create function private.update_project_start_date(p_mutation_id text,p_project_id bigint,p_expected_row_version bigint,p_start_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); fingerprint text; previous public.mutations%rowtype; project_row public.projects%rowtype; result jsonb; inserted integer;
begin
  if actor is null or not private.can_write_page(p_project_id,'tasks') then raise exception 'forbidden_project' using errcode='42501'; end if;
  if p_start_date is null or p_expected_row_version is null or length(coalesce(p_mutation_id,'')) not between 8 and 200 then raise exception 'invalid_input' using errcode='22023'; end if;
  fingerprint:=md5(concat_ws('|','PROJECT_START_DATE',p_project_id,p_expected_row_version,p_start_date));
  insert into public.mutations(mutation_id,request_hash,event_status_code,entity_type,entity_id,project_id,action_code,actor_user_id,actor_role_code)
  select p_mutation_id,fingerprint,'PREPARE','PROJECT',p_project_id,p_project_id,'UPDATE',actor,role_code from public.profiles where id=actor
  on conflict(mutation_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then
    select * into previous from public.mutations where mutation_id=p_mutation_id;
    if previous.actor_user_id is distinct from actor or previous.request_hash is distinct from fingerprint then raise exception 'mutation_id_reused' using errcode='22023'; end if;
    if previous.response_data is null then raise exception 'mutation_in_progress' using errcode='40001'; end if;
    return previous.response_data;
  end if;
  select * into project_row from public.projects where id=p_project_id and archived_at is null and status_code<>'DISABLED' for update;
  if not found then raise exception 'project_not_found' using errcode='P0002'; end if;
  if project_row.row_version<>p_expected_row_version then raise exception 'stale_row_version' using errcode='40001'; end if;
  update public.projects set start_date=p_start_date where id=p_project_id returning * into project_row;
  result:=jsonb_build_object('ok',true,'data',jsonb_build_object('item',jsonb_build_object('project_id',project_row.id,'start_date',project_row.start_date,'row_version',project_row.row_version)));
  update public.mutations set event_status_code='COMMIT',response_data=result where mutation_id=p_mutation_id;
  return result;
end $$;
revoke all on function private.update_project_start_date(text,bigint,bigint,date) from public,anon;
grant execute on function private.update_project_start_date(text,bigint,bigint,date) to authenticated,service_role;
create function public.update_project_start_date(p_mutation_id text,p_project_id bigint,p_expected_row_version bigint,p_start_date date)
returns jsonb language sql security invoker set search_path='' as $$
  select private.update_project_start_date(p_mutation_id,p_project_id,p_expected_row_version,p_start_date);
$$;
revoke all on function public.update_project_start_date(text,bigint,bigint,date) from public,anon;
grant execute on function public.update_project_start_date(text,bigint,bigint,date) to authenticated,service_role;
