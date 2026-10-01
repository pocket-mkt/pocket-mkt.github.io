-- Version matches the applied production migration ledger.
-- NS editors may select customer-public or team-only for newly imported tasks,
-- just as the existing import dialog allows. Keep project/page EDIT checks,
-- Pocket-only restrictions, existing-task visibility guards and RPC grants.
-- Patch only the CREATE guard to preserve independently evolved task behavior.
do $migration$
declare
  function_oid regprocedure := 'private.mutate_task(text,text,bigint,bigint,bigint,jsonb)'::regprocedure;
  definition text;
  old_guard text := $guard$if current_org = 'NS' and coalesce(nullif(p_fields ->> 'visibility_code', ''), 'PROJECT_TEAM') <> 'PROJECT_TEAM' then$guard$;
  new_guard text := $guard$if current_org = 'NS' and coalesce(nullif(p_fields ->> 'visibility_code', ''), 'PROJECT_TEAM') not in ('PROJECT_TEAM', 'CLIENT') then$guard$;
begin
  definition := pg_get_functiondef(function_oid);
  if (length(definition) - length(replace(definition, old_guard, ''))) <> length(old_guard) then
    raise exception 'NS creation visibility guard drifted; review before applying';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;
