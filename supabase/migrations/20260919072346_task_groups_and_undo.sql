set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.tasks add column task_group_id uuid, add column task_group_name text;
alter table public.tasks add constraint task_group_pair check (
  (task_group_id is null and task_group_name is null) or
  (task_group_id is not null and task_group_name is not null and length(trim(task_group_name)) between 1 and 100)
);
create index activity_events_task_undo_idx on public.activity_events(mutation_id, actor_user_id, project_id, id desc) where entity_type='TASK';

-- Extend the existing audited, version-checked write path (no direct table grants).
do $$
declare src text; patched text;
begin
 src := pg_get_functiondef('private.mutate_task(text,text,bigint,bigint,bigint,jsonb)'::regprocedure);
 patched := replace(src, '''legacy_id'', ''source_task_id'',', '''task_group_id'', ''task_group_name'', ''legacy_id'', ''source_task_id'',');
 patched := replace(patched, 'if operation_name = ''CREATE'' and (p_task_id',
   'if operation_name = ''CREATE'' and (p_fields ? ''task_group_id'' or p_fields ? ''task_group_name'') then raise exception ''group_existing_tasks_only'' using errcode=''22023''; end if;
    if operation_name = ''CREATE'' and (p_task_id');
 patched := replace(patched, 'title = case when p_fields',
   'task_group_id = case when p_fields ? ''task_group_id'' then nullif(p_fields ->> ''task_group_id'', '''')::uuid else task.task_group_id end,
    task_group_name = case when p_fields ? ''task_group_name'' then nullif(trim(p_fields ->> ''task_group_name''), '''') else task.task_group_name end,
    title = case when p_fields');
 if patched = src or position('task_group_id = case' in patched) = 0 then raise exception 'task_mutator_shape_changed'; end if;
 execute patched;
end $$;

do $$
declare src text; patched text;
begin
 src := pg_get_functiondef(coalesce(to_regprocedure('private.read_task_activity(bigint,integer,timestamptz,bigint)'),to_regprocedure('private.read_task_activity(bigint,integer)')));
 patched := replace(src, '(''title'', ''title''),', '(''task_group_name'', ''task_group_name''), (''title'', ''title''),');
 if patched = src then raise exception 'task_activity_shape_changed'; end if;
 execute patched;
end $$;

-- Only the undo function can supply restoration snapshots. This table is never
-- exposed through the API. A transaction-local row avoids trusting client GUCs.
create table private.task_undo_context (
 transaction_id bigint not null, task_id bigint not null,
 actor_user_id uuid not null, snapshot jsonb not null,
 primary key(transaction_id, task_id)
);
revoke all on private.task_undo_context from public, anon, authenticated;

create function private.restore_task_undo_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare saved jsonb;
begin
 select snapshot into saved from private.task_undo_context
 where transaction_id = txid_current() and task_id = new.id and actor_user_id = (select auth.uid());
 if found then
   new := jsonb_populate_record(new, saved - array['id','project_id','created_at','created_by_user_id','updated_at','updated_by_user_id','row_version','last_mutation_id']);
 end if;
 return new;
end $$;
revoke all on function private.restore_task_undo_snapshot() from public, anon, authenticated;
-- Runs after normalization, hold preservation and version/timestamp triggers.
create trigger tasks_zz_undo before update on public.tasks for each row execute function private.restore_task_undo_snapshot();

create function private.undo_task_changes(p_project_id bigint, p_mutation_ids text[], p_undo_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 uid uuid := (select auth.uid()); mid text; ev public.activity_events%rowtype;
 task public.tasks%rowtype; snapshot jsonb; result jsonb := '[]';
 fingerprint text; prior public.mutations%rowtype;
begin
 if uid is null or not private.can_write_page(p_project_id, 'tasks') then raise exception 'forbidden' using errcode='42501'; end if;
 if coalesce(cardinality(p_mutation_ids),0) not between 1 and 1000 or coalesce(length(p_undo_id),0) not between 8 and 200 then raise exception 'invalid_undo' using errcode='22023'; end if;
 if cardinality(p_mutation_ids) <> (select count(distinct x) from unnest(p_mutation_ids) x) then raise exception 'duplicate_mutation' using errcode='22023'; end if;
 fingerprint := md5(p_project_id::text || p_mutation_ids::text || uid::text);
 perform pg_advisory_xact_lock(hashtextextended(p_undo_id, 0));
 select * into prior from public.mutations where mutation_id = p_undo_id;
 if found then
   if prior.request_hash <> fingerprint or prior.actor_user_id <> uid or prior.action_code <> 'UNDO' then raise exception 'undo_id_conflict' using errcode='22023'; end if;
   return prior.response_data;
 end if;
 -- Stable lock order and one transaction for all selected tasks.
 perform t.id from public.tasks t where t.project_id=p_project_id and t.id in
 (select entity_id from public.activity_events where mutation_id=any(p_mutation_ids) and entity_type='TASK' and actor_user_id=uid)
 order by t.id for update;
 foreach mid in array p_mutation_ids loop
   select * into ev from public.activity_events where mutation_id=mid and project_id=p_project_id and entity_type='TASK' and actor_user_id=uid and event_status_code='COMMIT' order by id desc limit 1;
   if not found then raise exception 'undo_not_owned' using errcode='42501'; end if;
   select * into task from public.tasks where id=ev.entity_id and project_id=p_project_id;
   if not found or task.last_mutation_id is distinct from mid or task.row_version is distinct from (ev.after_data->>'row_version')::bigint then
     raise exception '업무가 이후에 변경되어 되돌릴 수 없습니다.' using errcode='40001';
   end if;
   snapshot := case when ev.action_code='CREATED' then to_jsonb(task) || jsonb_build_object('archived_at',now()) else ev.before_data end;
   if snapshot is null or snapshot='null'::jsonb then raise exception 'missing_snapshot' using errcode='22023'; end if;
   insert into private.task_undo_context values(txid_current(),task.id,uid,snapshot);
   update public.tasks set last_mutation_id=p_undo_id, updated_by_user_id=uid where id=task.id returning * into task;
   delete from private.task_undo_context where transaction_id=txid_current() and task_id=task.id;
   result := result || jsonb_build_array(jsonb_build_object('record',to_jsonb(task)));
 end loop;
 result := jsonb_build_object('ok',true,'data',jsonb_build_object('results',result));
 insert into public.mutations(mutation_id,request_hash,event_status_code,entity_type,project_id,action_code,actor_user_id,response_data)
 values(p_undo_id,fingerprint,'COMMIT','TASK',p_project_id,'UNDO',uid,result);
 return result;
end $$;
revoke all on function private.undo_task_changes(bigint,text[],text) from public, anon, authenticated;
grant execute on function private.undo_task_changes(bigint,text[],text) to authenticated;
create function public.undo_task_changes(p_project_id bigint,p_mutation_ids text[],p_undo_id text)
returns jsonb language sql security invoker set search_path='' as $$ select private.undo_task_changes(p_project_id,p_mutation_ids,p_undo_id); $$;
revoke all on function public.undo_task_changes(bigint,text[],text) from public, anon, authenticated;
grant execute on function public.undo_task_changes(bigint,text[],text) to authenticated;
