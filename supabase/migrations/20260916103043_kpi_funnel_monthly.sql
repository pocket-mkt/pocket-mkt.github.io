begin;
create table public.kpi_funnels (
 project_id bigint not null references public.projects(id),
 month date not null check (extract(day from month)=1),
 body jsonb not null,
 row_version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 mutation_id uuid not null,
 primary key(project_id,month)
);
alter table public.kpi_funnels enable row level security;
create index kpi_funnels_updated_by on public.kpi_funnels(updated_by);
revoke all on public.kpi_funnels from public,anon,authenticated;
create table private.kpi_funnel_audit (
 id bigint generated always as identity primary key,
 project_id bigint not null references public.projects(id), month date not null,
 actor_id uuid not null references auth.users(id), occurred_at timestamptz not null default now(),
 before_body jsonb,after_body jsonb not null,row_version bigint not null
);
create index kpi_funnel_audit_project_time on private.kpi_funnel_audit(project_id,occurred_at desc);
create index kpi_funnel_audit_actor on private.kpi_funnel_audit(actor_id);
alter table private.kpi_funnel_audit enable row level security;
revoke all on private.kpi_funnel_audit from public,anon,authenticated;

create function private.validate_kpi_funnel(b jsonb) returns void
language plpgsql set search_path='' as $$
declare c jsonb; k text; v numeric;
begin
 if b is null or jsonb_typeof(b)<>'object' or octet_length(b::text)>60000 then raise exception 'invalid_funnel' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(b) as fields(key) where fields.key not in ('name','goal','inflow_label','inflow_goal','definition','customer_visible','channels')) then raise exception 'unknown_funnel_field' using errcode='22023'; end if;
 foreach k in array array['name','inflow_label','definition'] loop
  if jsonb_typeof(b->k) is distinct from 'string' or length(trim(b->>k))=0 or length(b->>k)>200 then raise exception 'invalid_funnel_text' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(b->'customer_visible') is distinct from 'boolean' then raise exception 'invalid_visibility' using errcode='22023'; end if;
 foreach k in array array['goal','inflow_goal'] loop
  if not b ? k then raise exception 'missing_goal' using errcode='22023'; end if;
  if b->k<>'null'::jsonb then
   if jsonb_typeof(b->k)<>'number' then raise exception 'invalid_goal' using errcode='22023'; end if;
   v:=(b->>k)::numeric;
   if v<1 or v>1000000000 or v<>trunc(v) then raise exception 'invalid_goal' using errcode='22023'; end if;
  end if;
 end loop;
 if jsonb_typeof(b->'channels') is distinct from 'array' then raise exception 'invalid_channels' using errcode='22023'; end if;
 if jsonb_array_length(b->'channels')>40 then raise exception 'too_many_channels' using errcode='22023'; end if;
 for c in select value from jsonb_array_elements(b->'channels') loop
  if jsonb_typeof(c)<>'object' then raise exception 'invalid_channel' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(c) as fields(key) where fields.key not in ('id','name','type','visits','conversions','cost')) then raise exception 'unknown_channel_field' using errcode='22023'; end if;
  if jsonb_typeof(c->'id') is distinct from 'string' or (c->>'id') !~ '^[a-zA-Z0-9_-]{1,60}$' then raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if jsonb_typeof(c->'name') is distinct from 'string' or length(trim(c->>'name'))=0 or length(c->>'name')>80 then raise exception 'invalid_channel_name' using errcode='22023'; end if;
  if c->>'type' is null or c->>'type' not in ('AD','CONTENT','OTHER') then raise exception 'invalid_channel_type' using errcode='22023'; end if;
  foreach k in array array['visits','conversions','cost'] loop
   if not c ? k then raise exception 'missing_channel_metric' using errcode='22023'; end if;
   if c->k<>'null'::jsonb then
    if jsonb_typeof(c->k)<>'number' then raise exception 'invalid_metric' using errcode='22023'; end if;
    v:=(c->>k)::numeric;
    if v<0 or v>1000000000 or v<>trunc(v) then raise exception 'invalid_metric' using errcode='22023'; end if;
   end if;
  end loop;
  if (c->>'conversions')::numeric > (c->>'visits')::numeric then raise exception 'conversions_exceed_visits' using errcode='22023'; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(b->'channels')) then raise exception 'duplicate_channel' using errcode='22023'; end if;
end $$;
revoke all on function private.validate_kpi_funnel(jsonb) from public,anon,authenticated;

-- Private privileged implementations: expose only authorization-checked projections via invoker wrappers.
create function private.read_kpi_funnel(p_project_id bigint,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.kpi_funnels%rowtype; writer boolean; internal boolean; b jsonb;
begin
 if auth.uid() is null or not private.can_read_project(p_project_id,'CLIENT','performance') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 then raise exception 'invalid_month' using errcode='22023'; end if;
 internal:=private.can_read_project(p_project_id,'PROJECT_TEAM','performance');
 writer:=internal and private.can_write_project(p_project_id);
 select * into r from public.kpi_funnels where project_id=p_project_id and month=p_month;
 if not found or (not internal and not (r.body->>'customer_visible')::boolean) then return jsonb_build_object('item',null,'canWrite',writer,'internal',internal); end if;
 b:=r.body;
 if not internal then
  b:=jsonb_set(b,'{channels}',coalesce((select jsonb_agg(value-'cost') from jsonb_array_elements(b->'channels')),'[]'));
 end if;
 return jsonb_build_object('item',jsonb_build_object('body',b,'row_version',r.row_version,'month',r.month,'updated_at',r.updated_at),'canWrite',writer,'internal',internal);
end $$;
create function private.save_kpi_funnel(p_project_id bigint,p_month date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.kpi_funnels%rowtype; old_body jsonb;
begin
 if auth.uid() is null or not private.can_write_project(p_project_id) or not private.can_read_project(p_project_id,'PROJECT_TEAM','performance') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01' or p_month>'2100-12-01' or p_mutation_id is null then raise exception 'invalid_month_or_mutation' using errcode='22023'; end if;
 perform private.validate_kpi_funnel(p_body);
 perform pg_advisory_xact_lock(hashtextextended('kpi_funnel:'||p_project_id::text||':'||p_month::text,0));
 select * into r from public.kpi_funnels where project_id=p_project_id and month=p_month for update;
 if found then
  if r.mutation_id=p_mutation_id then
   if r.body<>p_body then raise exception 'mutation_reused' using errcode='22023'; end if;
   return private.read_kpi_funnel(p_project_id,p_month);
  end if;
  if p_expected_version is null or r.row_version<>p_expected_version then raise exception 'stale_row_version' using errcode='40001'; end if;
  old_body:=r.body;
  update public.kpi_funnels set body=p_body,row_version=row_version+1,updated_at=now(),updated_by=auth.uid(),mutation_id=p_mutation_id where project_id=p_project_id and month=p_month returning * into r;
 else
  if p_expected_version is not null then raise exception 'stale_row_version' using errcode='40001'; end if;
  insert into public.kpi_funnels(project_id,month,body,updated_by,mutation_id) values(p_project_id,p_month,p_body,auth.uid(),p_mutation_id) returning * into r;
 end if;
 insert into private.kpi_funnel_audit(project_id,month,actor_id,before_body,after_body,row_version) values(p_project_id,p_month,auth.uid(),old_body,p_body,r.row_version);
 return private.read_kpi_funnel(p_project_id,p_month);
end $$;
revoke all on function private.read_kpi_funnel(bigint,date),private.save_kpi_funnel(bigint,date,jsonb,bigint,uuid) from public,anon;
grant execute on function private.read_kpi_funnel(bigint,date),private.save_kpi_funnel(bigint,date,jsonb,bigint,uuid) to authenticated;
create function public.read_kpi_funnel(p_project_id bigint,p_month date) returns jsonb language sql security invoker set search_path='' as $$ select private.read_kpi_funnel(p_project_id,p_month) $$;
create function public.save_kpi_funnel(p_project_id bigint,p_month date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.save_kpi_funnel(p_project_id,p_month,p_body,p_expected_version,p_mutation_id) $$;
revoke all on function public.read_kpi_funnel(bigint,date),public.save_kpi_funnel(bigint,date,jsonb,bigint,uuid) from public,anon;
grant execute on function public.read_kpi_funnel(bigint,date),public.save_kpi_funnel(bigint,date,jsonb,bigint,uuid) to authenticated;
commit;
