begin;
-- A separate ledger: legacy monthly aggregates are never rewritten or added to daily totals.
create table public.kpi_daily_records (
 project_id bigint not null references public.projects(id),
 record_kind text not null check(record_kind in ('SETTINGS','DAY')),
 record_date date not null check(record_date between '2000-01-01' and '2100-12-31'),
 body jsonb not null,
 row_version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 primary key(project_id,record_kind,record_date),
 check(record_kind <> 'SETTINGS' or extract(day from record_date)=1)
);
create index kpi_daily_records_actor on public.kpi_daily_records(updated_by);
alter table public.kpi_daily_records enable row level security;
revoke all on public.kpi_daily_records from public,anon,authenticated;
create table private.kpi_daily_audit (
 id bigint generated always as identity primary key,
 project_id bigint not null references public.projects(id),
 record_kind text not null, record_date date not null,
 actor_id uuid not null references auth.users(id),
 mutation_id uuid not null unique, expected_version bigint,
 occurred_at timestamptz not null default now(),
 before_body jsonb, after_body jsonb not null, row_version bigint not null
);
create index kpi_daily_audit_target on private.kpi_daily_audit(project_id,record_kind,record_date,id desc);
create index kpi_daily_audit_actor on private.kpi_daily_audit(actor_id);
alter table private.kpi_daily_audit enable row level security;
revoke all on private.kpi_daily_audit from public,anon,authenticated;

create function private.validate_kpi_daily(k text,b jsonb) returns void
language plpgsql set search_path='' as $$
declare c jsonb; f text; v numeric; fields text[];
begin
 if b is null or jsonb_typeof(b)<>'object' or octet_length(b::text)>60000 or k not in ('SETTINGS','DAY') then raise exception 'invalid_daily_record' using errcode='22023'; end if;
 fields:=case when k='SETTINGS' then array['inflow_label','conversion_label','inflow_goal','conversion_goal','inflow_source','conversion_source','definition','rate_enabled','channels'] else array['visits','conversions','channels','execution','insight','next_action','pocket_request'] end;
 if exists(select 1 from jsonb_object_keys(b) x where not x=any(fields)) or not b ?& fields then raise exception 'unknown_or_missing_field' using errcode='22023'; end if;
 foreach f in array (case when k='SETTINGS' then array['inflow_label','conversion_label','inflow_source','conversion_source','definition'] else array['execution','insight','next_action','pocket_request'] end) loop
  if jsonb_typeof(b->f) is distinct from 'string' or length(b->>f)>(case when k='SETTINGS' then 200 else 3000 end) then raise exception 'invalid_text' using errcode='22023'; end if;
 end loop;
 if k='SETTINGS' and (length(trim(b->>'inflow_label'))=0 or length(trim(b->>'conversion_label'))=0 or jsonb_typeof(b->'rate_enabled') is distinct from 'boolean') then raise exception 'invalid_settings' using errcode='22023'; end if;
 if k='SETTINGS' and (b->>'rate_enabled')::boolean and (length(trim(b->>'inflow_source'))=0 or length(trim(b->>'conversion_source'))=0 or length(trim(b->>'definition'))=0) then raise exception 'rate_requires_definition' using errcode='22023'; end if;
 foreach f in array (case when k='SETTINGS' then array['inflow_goal','conversion_goal'] else array['visits','conversions'] end) loop
  if b->f<>'null'::jsonb then
   if jsonb_typeof(b->f)<>'number' then raise exception 'invalid_number' using errcode='22023'; end if;
   v:=(b->>f)::numeric;
   if v<(case when k='SETTINGS' then 1 else 0 end) or v>1000000000 or v<>trunc(v) then raise exception 'invalid_number' using errcode='22023'; end if;
  end if;
 end loop;
 if jsonb_typeof(b->'channels') is distinct from 'array' then raise exception 'invalid_channels' using errcode='22023'; end if;
 if jsonb_array_length(b->'channels')>40 then raise exception 'too_many_channels' using errcode='22023'; end if;
 for c in select value from jsonb_array_elements(b->'channels') loop
  fields:=case when k='SETTINGS' then array['id','name','type'] else array['id','name','type','cost','impressions','clicks','posts','visits','conversions','link'] end;
  if jsonb_typeof(c)<>'object' then raise exception 'invalid_channel' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(c) x where not x=any(fields)) or not c ?& fields then raise exception 'invalid_channel_fields' using errcode='22023'; end if;
  if jsonb_typeof(c->'id') is distinct from 'string' or (c->>'id') !~ '^[a-zA-Z0-9_-]{1,60}$' or jsonb_typeof(c->'name') is distinct from 'string' or length(trim(c->>'name'))=0 or length(c->>'name')>80 or coalesce(c->>'type','') not in ('AD','CONTENT','OTHER') then raise exception 'invalid_channel' using errcode='22023'; end if;
  if k='DAY' then
   foreach f in array array['cost','impressions','clicks','posts','visits','conversions'] loop
    if c->f<>'null'::jsonb then
     if jsonb_typeof(c->f)<>'number' then raise exception 'invalid_metric' using errcode='22023'; end if;
     v:=(c->>f)::numeric;
     if v<0 or v>1000000000 or v<>trunc(v) then raise exception 'invalid_metric' using errcode='22023'; end if;
    end if;
   end loop;
   if jsonb_typeof(c->'link') is distinct from 'string' or length(c->>'link')>2000 or ((c->>'link')<>'' and (c->>'link') !~* '^https?://[^[:space:]]+$') then raise exception 'invalid_link' using errcode='22023'; end if;
  end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(b->'channels')) then raise exception 'duplicate_channel' using errcode='22023'; end if;
end $$;
revoke all on function private.validate_kpi_daily(text,jsonb) from public,anon,authenticated;

create function private.read_kpi_daily(p_project_id bigint,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings jsonb; inherited jsonb; days jsonb; legacy boolean; prev_month date;
begin
 if auth.uid() is null or not private.can_read_project(p_project_id,'PROJECT_TEAM','performance') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01' or p_month>'2100-12-01' then raise exception 'invalid_month' using errcode='22023'; end if;
 select jsonb_build_object('body',r.body,'row_version',r.row_version,'updated_at',r.updated_at) into settings from public.kpi_daily_records r where project_id=p_project_id and record_kind='SETTINGS' and record_date=p_month;
 if settings is null then
  select body,record_date into inherited,prev_month from public.kpi_daily_records where project_id=p_project_id and record_kind='SETTINGS' and record_date<p_month order by record_date desc limit 1;
  -- A new month's goals must be explicitly set; retain labels and channel identities only.
  if inherited is not null then inherited:=inherited||jsonb_build_object('inflow_goal',null,'conversion_goal',null); end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('date',r.record_date,'body',r.body,'row_version',r.row_version,'updated_at',r.updated_at,'updated_by',coalesce(p.display_name,'운영팀')) order by r.record_date),'[]') into days
 from public.kpi_daily_records r left join public.profiles p on p.id=r.updated_by
 where r.project_id=p_project_id and r.record_kind='DAY' and r.record_date>=p_month and r.record_date<(p_month+interval '1 month');
 select exists(select 1 from public.kpi_funnels where project_id=p_project_id and month=p_month) into legacy;
 return jsonb_build_object('settings',settings,'inherited_settings',inherited,'inherited_month',prev_month,'days',days,'legacy_exists',legacy,'canWrite',private.can_write_page(p_project_id,'performance'),'internal',true);
end $$;

create function private.save_kpi_daily(p_project_id bigint,p_kind text,p_date date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.kpi_daily_records%rowtype; a private.kpi_daily_audit%rowtype; before_value jsonb; replayed boolean:=false;
begin
 if auth.uid() is null or not private.can_write_page(p_project_id,'performance') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('SETTINGS','DAY') or p_date is null or p_date<'2000-01-01' or p_date>'2100-12-31' or p_mutation_id is null or (p_kind='SETTINGS' and extract(day from p_date)<>1) or (p_kind='DAY' and p_date>(now() at time zone 'Asia/Seoul')::date) then raise exception 'invalid_date_or_kind' using errcode='22023'; end if;
 perform private.validate_kpi_daily(p_kind,p_body);
 perform pg_advisory_xact_lock(hashtextextended('kpi_daily_mutation:'||p_mutation_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('kpi_daily:'||p_project_id::text||':'||p_kind||':'||p_date::text,0));
 select * into a from private.kpi_daily_audit where mutation_id=p_mutation_id;
 if found then
  if a.actor_id<>auth.uid() or a.project_id<>p_project_id or a.record_kind<>p_kind or a.record_date<>p_date or a.after_body<>p_body or a.expected_version is distinct from p_expected_version then raise exception 'mutation_reused' using errcode='22023'; end if;
  replayed:=true;
 end if;
 select * into r from public.kpi_daily_records where project_id=p_project_id and record_kind=p_kind and record_date=p_date for update;
 if not replayed then
  if found then
   if p_expected_version is null or r.row_version<>p_expected_version then raise exception 'stale_row_version' using errcode='40001'; end if;
   before_value:=r.body;
   update public.kpi_daily_records set body=p_body,row_version=row_version+1,updated_at=now(),updated_by=auth.uid() where project_id=p_project_id and record_kind=p_kind and record_date=p_date returning * into r;
  else
   if p_expected_version is not null then raise exception 'stale_row_version' using errcode='40001'; end if;
   insert into public.kpi_daily_records(project_id,record_kind,record_date,body,updated_by) values(p_project_id,p_kind,p_date,p_body,auth.uid()) returning * into r;
  end if;
  insert into private.kpi_daily_audit(project_id,record_kind,record_date,actor_id,mutation_id,expected_version,before_body,after_body,row_version) values(p_project_id,p_kind,p_date,auth.uid(),p_mutation_id,p_expected_version,before_value,p_body,r.row_version);
 end if;
 return jsonb_build_object('item',jsonb_build_object('date',r.record_date,'body',r.body,'row_version',r.row_version,'updated_at',r.updated_at,'updated_by',(select display_name from public.profiles where id=r.updated_by)),'replayed',replayed);
end $$;

create function private.read_kpi_daily_history(p_project_id bigint,p_kind text,p_date date,p_before_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if auth.uid() is null or not private.can_read_project(p_project_id,'PROJECT_TEAM','performance') then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]') into rows from (
  select a.id,a.occurred_at,a.row_version,coalesce(p.display_name,'운영팀') as actor,a.before_body,a.after_body
  from private.kpi_daily_audit a left join public.profiles p on p.id=a.actor_id
  where a.project_id=p_project_id and a.record_kind=p_kind and a.record_date=p_date and (p_before_id is null or a.id<p_before_id)
  order by a.id desc limit 10
 ) x;
 return jsonb_build_object('items',rows,'next_cursor',case when jsonb_array_length(rows)=10 then rows->9->>'id' else null end);
end $$;
revoke all on function private.read_kpi_daily(bigint,date),private.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid),private.read_kpi_daily_history(bigint,text,date,bigint) from public,anon;
grant execute on function private.read_kpi_daily(bigint,date),private.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid),private.read_kpi_daily_history(bigint,text,date,bigint) to authenticated;
create function public.read_kpi_daily(p_project_id bigint,p_month date) returns jsonb language sql security invoker set search_path='' as $$ select private.read_kpi_daily(p_project_id,p_month) $$;
create function public.save_kpi_daily(p_project_id bigint,p_kind text,p_date date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.save_kpi_daily(p_project_id,p_kind,p_date,p_body,p_expected_version,p_mutation_id) $$;
create function public.read_kpi_daily_history(p_project_id bigint,p_kind text,p_date date,p_before_id bigint default null) returns jsonb language sql security invoker set search_path='' as $$ select private.read_kpi_daily_history(p_project_id,p_kind,p_date,p_before_id) $$;
revoke all on function public.read_kpi_daily(bigint,date),public.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid),public.read_kpi_daily_history(bigint,text,date,bigint) from public,anon;
grant execute on function public.read_kpi_daily(bigint,date),public.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid),public.read_kpi_daily_history(bigint,text,date,bigint) to authenticated;
commit;
