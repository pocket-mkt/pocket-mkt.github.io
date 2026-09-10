-- Internal project blog management. No external search service or scheduled jobs.
create table public.blog_targets (
 id uuid primary key default gen_random_uuid(),
 project_id bigint not null references public.projects(id),
 platform text not null check(platform in ('NAVER','GOOGLE')),
 title text not null check(length(btrim(title)) between 1 and 300),
 url text not null check(length(url)<=2000 and url ~* '^https?://[^[:space:]]+$'),
 keyword text not null check(length(btrim(keyword)) between 1 and 100),
 published_on date not null,
 monthly_volume integer check(monthly_volume>=0),
 goal_rank integer not null default 5 check(goal_rank between 1 and 100),
 archived boolean not null default false,
 row_version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index blog_targets_unique_active on public.blog_targets(project_id,platform,url,keyword) where not archived;
create index blog_targets_project on public.blog_targets(project_id,platform,id) where not archived;
create table public.blog_rank_records (
 id uuid primary key default gen_random_uuid(),
 target_id uuid not null references public.blog_targets(id),
 recorded_on date not null,
 rank integer,
 state text not null check(state in ('RANKED','OUT','ERROR')),
 row_version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((state='RANKED' and rank between 1 and 100 and rank is not null) or (state in ('OUT','ERROR') and rank is null)),
 unique(target_id,recorded_on)
);
alter table public.blog_targets enable row level security;
alter table public.blog_rank_records enable row level security;
revoke all on public.blog_targets,public.blog_rank_records from public,anon,authenticated;
grant select on public.blog_targets,public.blog_rank_records to authenticated;
grant insert(id,project_id,platform,title,url,keyword,published_on,monthly_volume,goal_rank) on public.blog_targets to authenticated;
grant update(title,url,keyword,published_on,monthly_volume,goal_rank,archived) on public.blog_targets to authenticated;
grant insert(target_id,recorded_on,rank,state) on public.blog_rank_records to authenticated;
grant update(recorded_on,rank,state) on public.blog_rank_records to authenticated;
create policy blog_internal_read on public.blog_targets for select to authenticated using(private.can_manage_project_credentials(project_id));
create policy blog_internal_create on public.blog_targets for insert to authenticated with check(private.can_manage_project_credentials(project_id));
create policy blog_internal_update on public.blog_targets for update to authenticated using(private.can_manage_project_credentials(project_id)) with check(private.can_manage_project_credentials(project_id));
create policy blog_rank_read on public.blog_rank_records for select to authenticated using(exists(select 1 from public.blog_targets t where t.id=target_id and not t.archived and private.can_manage_project_credentials(t.project_id)));
create policy blog_rank_create on public.blog_rank_records for insert to authenticated with check(exists(select 1 from public.blog_targets t where t.id=target_id and not t.archived and private.can_manage_project_credentials(t.project_id)));
create policy blog_rank_update on public.blog_rank_records for update to authenticated using(exists(select 1 from public.blog_targets t where t.id=target_id and not t.archived and private.can_manage_project_credentials(t.project_id))) with check(exists(select 1 from public.blog_targets t where t.id=target_id and not t.archived and private.can_manage_project_credentials(t.project_id)));
create function private.blog_version_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then new.row_version=old.row_version+1;new.created_at=old.created_at;else new.row_version=1;new.created_at=now();end if;
 new.updated_at=now();
 if tg_table_name='blog_rank_records' then
  if new.recorded_on>(now() at time zone 'Asia/Seoul')::date then raise exception 'future_measurement' using errcode='22023';end if;
 end if;
 return new;
end $$;
revoke all on function private.blog_version_guard() from public,anon,authenticated;
create trigger blog_target_version before insert or update on public.blog_targets for each row execute function private.blog_version_guard();
create trigger blog_rank_version before insert or update on public.blog_rank_records for each row execute function private.blog_version_guard();
-- Immutable server-side history; no public API privileges.
create table private.blog_change_log(id bigint generated always as identity primary key,entity text not null,record_id uuid not null,actor_id uuid,changed_at timestamptz not null default now(),before_data jsonb,after_data jsonb);
revoke all on private.blog_change_log from public,anon,authenticated;
alter table private.blog_change_log enable row level security;
create function private.audit_blog_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.blog_change_log(entity,record_id,actor_id,before_data,after_data) values(tg_table_name,new.id,(select auth.uid()),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function private.audit_blog_change() from public,anon,authenticated;
create trigger blog_target_audit after insert or update on public.blog_targets for each row execute function private.audit_blog_change();
create trigger blog_rank_audit after insert or update on public.blog_rank_records for each row execute function private.audit_blog_change();
