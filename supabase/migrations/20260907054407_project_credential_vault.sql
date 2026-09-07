-- Project-scoped internal credential ledger.
-- Passwords live in Supabase Vault and are decrypted only by an explicit,
-- audited reveal RPC after the caller's active project membership is checked.

do $$
begin
  if not exists (
    select 1
      from pg_proc proc
      join pg_namespace namespace on namespace.oid = proc.pronamespace
     where namespace.nspname = 'vault'
       and proc.proname = 'create_secret'
  ) then
    create extension if not exists supabase_vault with schema vault;
  end if;
end;
$$;

create table public.project_credentials (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  site_name text not null,
  site_url text,
  account_identifier text not null,
  password_secret_id uuid not null,
  notes text,
  created_by_user_id uuid not null references public.profiles(id),
  updated_by_user_id uuid not null references public.profiles(id),
  last_mutation_id text,
  last_operation_code text check (last_operation_code in ('CREATE', 'UPDATE', 'ARCHIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1 check (row_version > 0),
  archived_at timestamptz,
  constraint project_credentials_site_name_check
    check (char_length(btrim(site_name)) between 1 and 160),
  constraint project_credentials_site_url_check
    check (site_url is null or (char_length(site_url) <= 1000 and site_url ~* '^https?://')),
  constraint project_credentials_account_identifier_check
    check (char_length(btrim(account_identifier)) between 1 and 320),
  constraint project_credentials_notes_check
    check (notes is null or char_length(notes) <= 2000)
);

create index project_credentials_project_active_idx
  on public.project_credentials(project_id, site_name, id)
  where archived_at is null;
create index project_credentials_created_by_idx
  on public.project_credentials(created_by_user_id);
create index project_credentials_updated_by_idx
  on public.project_credentials(updated_by_user_id);
create unique index project_credentials_last_mutation_uidx
  on public.project_credentials(last_mutation_id)
  where last_mutation_id is not null;

alter table public.project_credentials enable row level security;
alter table public.project_credentials force row level security;

create or replace function private.can_manage_project_credentials(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
        from public.projects project
       where project.id = target_project_id
         and project.status_code <> 'DISABLED'
         and project.archived_at is null
    )
    and (
      (select private.is_pocket_manager())
      or exists (
        select 1
          from public.profiles profile
          join public.project_memberships membership
            on membership.user_id = profile.id
           and membership.project_id = target_project_id
         where profile.id = (select auth.uid())
           and profile.status_code = 'ACTIVE'
           and profile.archived_at is null
           and (
             (profile.organization_code = 'POCKET' and profile.role_code = 'POCKET_EDITOR')
             or (profile.organization_code = 'NS' and profile.role_code = 'EXECUTOR_EDITOR')
           )
           and membership.permission_code in ('ADMIN', 'EDIT')
           and membership.status_code = 'ACTIVE'
           and membership.archived_at is null
      )
    );
$$;

revoke all on function private.can_manage_project_credentials(bigint)
  from public, anon;
grant execute on function private.can_manage_project_credentials(bigint)
  to authenticated, service_role;

create policy project_credentials_select on public.project_credentials
  for select to authenticated
  using ((select private.can_manage_project_credentials(project_id)));
create policy project_credentials_insert on public.project_credentials
  for insert to authenticated
  with check (
    (select private.can_manage_project_credentials(project_id))
    and created_by_user_id = (select auth.uid())
    and updated_by_user_id = (select auth.uid())
  );
create policy project_credentials_update on public.project_credentials
  for update to authenticated
  using ((select private.can_manage_project_credentials(project_id)))
  with check (
    (select private.can_manage_project_credentials(project_id))
    and updated_by_user_id = (select auth.uid())
  );

create trigger project_credentials_touch
  before update on public.project_credentials
  for each row execute function private.touch_row();

create or replace function private.audit_project_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'password_secret_id' end;
  new_data jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'password_secret_id' end;
  action_name text;
  actor_role text;
begin
  if tg_op = 'INSERT' then
    action_name := 'CREATED';
  elsif tg_op = 'DELETE' or (old.archived_at is null and new.archived_at is not null) then
    action_name := 'ARCHIVED';
  elsif old.archived_at is not null and new.archived_at is null then
    action_name := 'RESTORED';
  else
    action_name := 'UPDATED';
  end if;

  select profile.role_code
    into actor_role
    from public.profiles profile
   where profile.id = (select auth.uid());

  insert into public.activity_events (
    mutation_id, project_id, entity_type, entity_id, action_code,
    before_data, after_data, visibility_code, actor_user_id,
    actor_role_code, event_status_code
  ) values (
    coalesce(new.last_mutation_id, old.last_mutation_id),
    coalesce(new.project_id, old.project_id),
    'PROJECT_CREDENTIAL',
    coalesce(new.id, old.id),
    action_name,
    old_data,
    new_data,
    'PROJECT_TEAM',
    (select auth.uid()),
    actor_role,
    'COMMIT'
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_project_credential()
  from public, anon, authenticated;

create trigger project_credentials_audit
  after insert or update on public.project_credentials
  for each row execute function private.audit_project_credential();

create or replace function private.delete_project_credential_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.password_secret_id;
  return old;
end;
$$;

revoke all on function private.delete_project_credential_secret()
  from public, anon, authenticated;

create trigger project_credentials_delete_secret
  before delete on public.project_credentials
  for each row execute function private.delete_project_credential_secret();

create or replace function private.read_project_credentials(p_project_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_items jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not (select private.can_manage_project_credentials(p_project_id)) then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'credential_id', credential.id,
    'project_id', credential.project_id,
    'site_name', credential.site_name,
    'site_url', credential.site_url,
    'account_identifier', credential.account_identifier,
    'notes', credential.notes,
    'created_by_user_id', credential.created_by_user_id,
    'created_by_name', creator.display_name,
    'updated_by_user_id', credential.updated_by_user_id,
    'updated_by_name', editor.display_name,
    'created_at', credential.created_at,
    'updated_at', credential.updated_at,
    'row_version', credential.row_version
  ) order by lower(credential.site_name), credential.id), '[]'::jsonb)
    into result_items
    from public.project_credentials credential
    left join public.profiles creator on creator.id = credential.created_by_user_id
    left join public.profiles editor on editor.id = credential.updated_by_user_id
   where credential.project_id = p_project_id
     and credential.archived_at is null;

  return jsonb_build_object(
    'items', result_items,
    'totalMatching', jsonb_array_length(result_items),
    'canWrite', true
  );
end;
$$;

create or replace function private.reveal_project_credential(
  p_project_id bigint,
  p_credential_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential_row public.project_credentials%rowtype;
  revealed_password text;
  actor_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not (select private.can_manage_project_credentials(p_project_id)) then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;

  select credential.*
    into credential_row
    from public.project_credentials credential
   where credential.id = p_credential_id
     and credential.project_id = p_project_id
     and credential.archived_at is null;
  if not found then
    raise exception 'credential_not_found' using errcode = 'P0002';
  end if;

  select secret.decrypted_secret
    into revealed_password
    from vault.decrypted_secrets secret
   where secret.id = credential_row.password_secret_id;
  if revealed_password is null then
    raise exception 'credential_secret_missing' using errcode = 'P0002';
  end if;

  select profile.role_code
    into actor_role
    from public.profiles profile
   where profile.id = (select auth.uid());
  insert into public.activity_events (
    project_id, entity_type, entity_id, action_code, before_data,
    after_data, visibility_code, actor_user_id, actor_role_code,
    event_status_code
  ) values (
    p_project_id, 'PROJECT_CREDENTIAL', credential_row.id, 'UPDATED',
    null,
    jsonb_build_object('event', 'PASSWORD_REVEALED', 'site_name', credential_row.site_name),
    'PROJECT_TEAM', (select auth.uid()), actor_role, 'COMMIT'
  );

  return jsonb_build_object(
    'credentialId', credential_row.id,
    'password', revealed_password,
    'revealedAt', now()
  );
end;
$$;

create or replace function private.mutate_project_credential(
  p_mutation_id text,
  p_operation text,
  p_project_id bigint,
  p_credential_id bigint default null,
  p_expected_row_version bigint default null,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_code text := upper(btrim(coalesce(p_operation, '')));
  current_user_id uuid := (select auth.uid());
  credential_row public.project_credentials%rowtype;
  secret_id uuid;
  site_name_value text;
  site_url_value text;
  account_value text;
  password_value text;
  notes_value text;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not (select private.can_manage_project_credentials(p_project_id)) then
    raise exception 'forbidden_project' using errcode = '42501';
  end if;
  if p_mutation_id is null or btrim(p_mutation_id) = '' or char_length(p_mutation_id) > 200 then
    raise exception 'invalid_mutation_id' using errcode = '22023';
  end if;
  if operation_code not in ('CREATE', 'UPDATE', 'ARCHIVE') then
    raise exception 'unsupported_operation' using errcode = '22023';
  end if;

  select credential.*
    into credential_row
    from public.project_credentials credential
   where credential.last_mutation_id = p_mutation_id;
  if found then
    if credential_row.project_id <> p_project_id
       or credential_row.last_operation_code <> operation_code
       or (operation_code <> 'CREATE' and credential_row.id <> p_credential_id) then
      raise exception 'mutation_id_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'item', jsonb_build_object(
        'credential_id', credential_row.id,
        'row_version', credential_row.row_version,
        'archived', credential_row.archived_at is not null
      ),
      'replayed', true
    ));
  end if;

  if operation_code = 'CREATE' then
    site_name_value := btrim(coalesce(p_fields ->> 'site_name', ''));
    site_url_value := nullif(btrim(coalesce(p_fields ->> 'site_url', '')), '');
    account_value := btrim(coalesce(p_fields ->> 'account_identifier', ''));
    password_value := coalesce(p_fields ->> 'password', '');
    notes_value := nullif(btrim(coalesce(p_fields ->> 'notes', '')), '');
    if site_name_value = '' then raise exception 'site_name_required' using errcode = '22023'; end if;
    if account_value = '' then raise exception 'account_identifier_required' using errcode = '22023'; end if;
    if char_length(password_value) < 1 or char_length(password_value) > 2048 then
      raise exception 'password_required' using errcode = '22023';
    end if;
    if site_url_value is not null and site_url_value !~* '^https?://' then
      raise exception 'invalid_site_url' using errcode = '22023';
    end if;

    select vault.create_secret(
      password_value,
      null,
      format('Pocket Marketing Hub project credential %s', p_project_id)
    ) into secret_id;
    insert into public.project_credentials (
      project_id, site_name, site_url, account_identifier,
      password_secret_id, notes, created_by_user_id, updated_by_user_id,
      last_mutation_id, last_operation_code
    ) values (
      p_project_id, site_name_value, site_url_value, account_value,
      secret_id, notes_value, current_user_id, current_user_id,
      p_mutation_id, operation_code
    ) returning * into credential_row;
  else
    if p_credential_id is null or p_expected_row_version is null then
      raise exception 'credential_version_required' using errcode = '22023';
    end if;
    select credential.*
      into credential_row
      from public.project_credentials credential
     where credential.id = p_credential_id
       and credential.project_id = p_project_id
       and credential.archived_at is null
     for update;
    if not found then raise exception 'credential_not_found' using errcode = 'P0002'; end if;
    if credential_row.row_version <> p_expected_row_version then
      raise exception 'stale_row_version' using errcode = '40001';
    end if;

    if operation_code = 'ARCHIVE' then
      delete from vault.secrets where id = credential_row.password_secret_id;
      update public.project_credentials credential
         set archived_at = now(),
             updated_by_user_id = current_user_id,
             last_mutation_id = p_mutation_id,
             last_operation_code = operation_code
       where credential.id = credential_row.id
       returning * into credential_row;
    else
      site_name_value := case when p_fields ? 'site_name' then btrim(coalesce(p_fields ->> 'site_name', '')) else credential_row.site_name end;
      site_url_value := case when p_fields ? 'site_url' then nullif(btrim(coalesce(p_fields ->> 'site_url', '')), '') else credential_row.site_url end;
      account_value := case when p_fields ? 'account_identifier' then btrim(coalesce(p_fields ->> 'account_identifier', '')) else credential_row.account_identifier end;
      notes_value := case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields ->> 'notes', '')), '') else credential_row.notes end;
      if site_name_value = '' then raise exception 'site_name_required' using errcode = '22023'; end if;
      if account_value = '' then raise exception 'account_identifier_required' using errcode = '22023'; end if;
      if site_url_value is not null and site_url_value !~* '^https?://' then
        raise exception 'invalid_site_url' using errcode = '22023';
      end if;
      if p_fields ? 'password' then
        password_value := coalesce(p_fields ->> 'password', '');
        if char_length(password_value) < 1 or char_length(password_value) > 2048 then
          raise exception 'password_required' using errcode = '22023';
        end if;
        perform vault.update_secret(credential_row.password_secret_id, password_value);
      end if;
      update public.project_credentials credential
         set site_name = site_name_value,
             site_url = site_url_value,
             account_identifier = account_value,
             notes = notes_value,
             updated_by_user_id = current_user_id,
             last_mutation_id = p_mutation_id,
             last_operation_code = operation_code
       where credential.id = credential_row.id
       returning * into credential_row;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'item', jsonb_build_object(
      'credential_id', credential_row.id,
      'row_version', credential_row.row_version,
      'archived', credential_row.archived_at is not null
    )
  ));
end;
$$;

create function public.read_project_credentials(p_project_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.read_project_credentials(p_project_id); $$;

create function public.reveal_project_credential(
  p_project_id bigint,
  p_credential_id bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.reveal_project_credential(p_project_id, p_credential_id); $$;

create function public.mutate_project_credential(
  p_mutation_id text,
  p_operation text,
  p_project_id bigint,
  p_credential_id bigint default null,
  p_expected_row_version bigint default null,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.mutate_project_credential(
    p_mutation_id, p_operation, p_project_id, p_credential_id,
    p_expected_row_version, p_fields
  );
$$;

revoke all on table public.project_credentials from public, anon, authenticated;
revoke all on function private.read_project_credentials(bigint) from public, anon;
revoke all on function private.reveal_project_credential(bigint, bigint) from public, anon;
revoke all on function private.mutate_project_credential(text, text, bigint, bigint, bigint, jsonb) from public, anon;
revoke all on function public.read_project_credentials(bigint) from public, anon, authenticated;
revoke all on function public.reveal_project_credential(bigint, bigint) from public, anon, authenticated;
revoke all on function public.mutate_project_credential(text, text, bigint, bigint, bigint, jsonb) from public, anon, authenticated;

grant execute on function private.read_project_credentials(bigint) to authenticated, service_role;
grant execute on function private.reveal_project_credential(bigint, bigint) to authenticated, service_role;
grant execute on function private.mutate_project_credential(text, text, bigint, bigint, bigint, jsonb) to authenticated, service_role;
grant execute on function public.read_project_credentials(bigint) to authenticated, service_role;
grant execute on function public.reveal_project_credential(bigint, bigint) to authenticated, service_role;
grant execute on function public.mutate_project_credential(text, text, bigint, bigint, bigint, jsonb) to authenticated, service_role;

comment on table public.project_credentials is
  'Project-scoped Pocket/NS credential metadata. Password plaintext is never stored in this table.';
comment on function public.reveal_project_credential(bigint, bigint) is
  'Returns one Vault-decrypted password after active internal project authorization and writes a reveal audit event.';
