begin;
-- Extend the same project/month ledger, without rewriting DAY or legacy KPI data.
alter table public.kpi_daily_records drop constraint kpi_daily_records_record_kind_check;
alter table public.kpi_daily_records add constraint kpi_daily_records_record_kind_check check(record_kind in ('SETTINGS','DAY','STAGE_1','STAGE_2','STAGE_3','GOALS'));
alter table public.kpi_daily_records add constraint kpi_sheet_month_start check(record_kind='DAY' or extract(day from record_date)=1);

create function private.validate_kpi_sheet(k text,m date,b jsonb) returns void
language plpgsql set search_path='' as $$
declare e jsonb; f text; fields text[]; arr jsonb; n numeric; d1 date; d2 date;
begin
 if b is null or jsonb_typeof(b)<>'object' or octet_length(b::text)>120000 then raise exception 'invalid_sheet' using errcode='22023'; end if;
 f:=case when k='GOALS' then 'goals' else 'entries' end;
 if not b ? f or (select count(*) from jsonb_object_keys(b))<>1 or jsonb_typeof(b->f) is distinct from 'array' then raise exception 'invalid_sheet_fields' using errcode='22023'; end if;
 arr:=b->f;
 if jsonb_array_length(arr)>(case when k='GOALS' then 5 else 250 end) then raise exception 'too_many_sheet_rows' using errcode='22023'; end if;
 for e in select value from jsonb_array_elements(arr) loop
  fields:=case when k='GOALS' then array['id','title','metric','target','direction'] when k='STAGE_1' then array['id','start','end','source','note','cost','impressions','clicks','posts'] else array['id','start','end','source','note','value'] end;
  if jsonb_typeof(e)<>'object' then raise exception 'invalid_sheet_row' using errcode='22023'; end if;
  if not e ?& fields or exists(select 1 from jsonb_object_keys(e) x where not x=any(fields)) then raise exception 'invalid_sheet_row_fields' using errcode='22023'; end if;
  if jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~ '^[a-zA-Z0-9_-]{1,60}$' then raise exception 'invalid_row_id' using errcode='22023'; end if;
  if k='GOALS' then
   if jsonb_typeof(e->'title') is distinct from 'string' or length(trim(e->>'title'))=0 or length(e->>'title')>80 or coalesce(e->>'metric','') not in ('cost','impressions','clicks','posts','visits','conversions') or coalesce(e->>'direction','') not in ('AT_LEAST','AT_MOST') then raise exception 'invalid_goal' using errcode='22023'; end if;
   fields:=array['target'];
  else
   if jsonb_typeof(e->'source') is distinct from 'string' or length(trim(e->>'source'))=0 or length(e->>'source')>80 or jsonb_typeof(e->'note') is distinct from 'string' or length(e->>'note')>500 or coalesce(e->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(e->>'end','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_period' using errcode='22023'; end if;
   begin d1:=(e->>'start')::date; d2:=(e->>'end')::date; exception when others then raise exception 'invalid_period' using errcode='22023'; end;
   if d1<m or d2>=m+interval '1 month' or d1>d2 or d2>(now() at time zone 'Asia/Seoul')::date then raise exception 'invalid_period' using errcode='22023'; end if;
   fields:=case when k='STAGE_1' then array['cost','impressions','clicks','posts'] else array['value'] end;
   if k='STAGE_1' and not exists(select 1 from unnest(fields) x where e->x<>'null'::jsonb) then raise exception 'empty_metrics' using errcode='22023'; end if;
  end if;
  foreach f in array fields loop
   if e->f='null'::jsonb and k='STAGE_1' then continue; end if;
   if jsonb_typeof(e->f) is distinct from 'number' then raise exception 'invalid_metric' using errcode='22023'; end if;
   n:=(e->>f)::numeric;
   if n<(case when k='GOALS' then 1 else 0 end) or n>1000000000 or n<>trunc(n) then raise exception 'invalid_metric' using errcode='22023'; end if;
  end loop;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(arr)) then raise exception 'duplicate_row_id' using errcode='22023'; end if;
 if k<>'GOALS' and exists(
  select 1 from jsonb_array_elements(arr) with ordinality a(e,i),jsonb_array_elements(arr) with ordinality z(e,i)
  where a.i<z.i and (a.e->>'start')<=(z.e->>'end') and (z.e->>'start')<=(a.e->>'end') and (k<>'STAGE_1' or lower(trim(a.e->>'source'))=lower(trim(z.e->>'source')))
 ) then raise exception 'overlapping_kpi_period' using errcode='23P01'; end if;
end $$;
revoke all on function private.validate_kpi_sheet(text,date,jsonb) from public,anon,authenticated;

create function private.check_kpi_sheet_overlap(p bigint,k text,d date,b jsonb) returns void
language plpgsql set search_path='' as $$
declare e jsonb; c jsonb; r record; stage text; m date:=date_trunc('month',d)::date;
begin
 if k like 'STAGE_%' then
  for e in select value from jsonb_array_elements(b->'entries') loop
   for r in select body from public.kpi_daily_records where project_id=p and record_kind='DAY' and record_date between (e->>'start')::date and (e->>'end')::date loop
    if (k='STAGE_2' and r.body->'visits'<>'null'::jsonb) or (k='STAGE_3' and r.body->'conversions'<>'null'::jsonb) then raise exception 'overlapping_kpi_period' using errcode='23P01'; end if;
    if k='STAGE_1' then
     for c in select value from jsonb_array_elements(r.body->'channels') loop
      if lower(trim(c->>'name'))=lower(trim(e->>'source')) and exists(select 1 from unnest(array['cost','impressions','clicks','posts']) x where c->x<>'null'::jsonb) then raise exception 'overlapping_kpi_period' using errcode='23P01'; end if;
     end loop;
    end if;
   end loop;
  end loop;
 elsif k='DAY' then
  for r in select record_kind,body from public.kpi_daily_records where project_id=p and record_date=m and record_kind in ('STAGE_1','STAGE_2','STAGE_3') loop
   for e in select value from jsonb_array_elements(r.body->'entries') where d between (value->>'start')::date and (value->>'end')::date loop
    if (r.record_kind='STAGE_2' and b->'visits'<>'null'::jsonb) or (r.record_kind='STAGE_3' and b->'conversions'<>'null'::jsonb) then raise exception 'overlapping_kpi_period' using errcode='23P01'; end if;
    if r.record_kind='STAGE_1' then
     for c in select value from jsonb_array_elements(b->'channels') loop
      if lower(trim(c->>'name'))=lower(trim(e->>'source')) and exists(select 1 from unnest(array['cost','impressions','clicks','posts']) x where c->x<>'null'::jsonb) then raise exception 'overlapping_kpi_period' using errcode='23P01'; end if;
     end loop;
    end if;
   end loop;
  end loop;
 end if;
end $$;
revoke all on function private.check_kpi_sheet_overlap(bigint,text,date,jsonb) from public,anon,authenticated;

alter function private.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid) rename to save_kpi_daily_base;
revoke all on function private.save_kpi_daily_base(bigint,text,date,jsonb,bigint,uuid) from public,anon,authenticated;
create function private.save_kpi_daily(p_project_id bigint,p_kind text,p_date date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.kpi_daily_records%rowtype; a private.kpi_daily_audit%rowtype; before_value jsonb; replayed boolean:=false;
begin
 if auth.uid() is null or not private.can_write_page(p_project_id,'performance') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('SETTINGS','DAY','STAGE_1','STAGE_2','STAGE_3','GOALS') or p_date is null or p_date<'2000-01-01' or p_date>'2100-12-31' or p_mutation_id is null or (p_kind<>'DAY' and extract(day from p_date)<>1) then raise exception 'invalid_date_or_kind' using errcode='22023'; end if;
 -- DAY and stage sheets share the same lock to prevent cross-format overlaps.
 perform pg_advisory_xact_lock(hashtextextended('kpi_sheet_month:'||p_project_id::text||':'||date_trunc('month',p_date)::date::text,0));
 if p_kind in ('SETTINGS','DAY') then
  perform private.validate_kpi_daily(p_kind,p_body);
  if not exists(select 1 from private.kpi_daily_audit where mutation_id=p_mutation_id) then perform private.check_kpi_sheet_overlap(p_project_id,p_kind,p_date,p_body); end if;
  return private.save_kpi_daily_base(p_project_id,p_kind,p_date,p_body,p_expected_version,p_mutation_id);
 end if;
 perform private.validate_kpi_sheet(p_kind,p_date,p_body);
 perform pg_advisory_xact_lock(hashtextextended('kpi_daily_mutation:'||p_mutation_id::text,0));
 select * into a from private.kpi_daily_audit where mutation_id=p_mutation_id;
 if found then
  if a.actor_id<>auth.uid() or a.project_id<>p_project_id or a.record_kind<>p_kind or a.record_date<>p_date or a.after_body<>p_body or a.expected_version is distinct from p_expected_version then raise exception 'mutation_reused' using errcode='22023'; end if;
  replayed:=true;
 end if;
 if not replayed then perform private.check_kpi_sheet_overlap(p_project_id,p_kind,p_date,p_body); end if;
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

alter function private.read_kpi_daily(bigint,date) rename to read_kpi_daily_base;
revoke all on function private.read_kpi_daily_base(bigint,date) from public,anon,authenticated;
create function private.read_kpi_daily(p_project_id bigint,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; sheets jsonb; goals jsonb;
begin
 result:=private.read_kpi_daily_base(p_project_id,p_month);
 select coalesce(jsonb_object_agg(record_kind,jsonb_build_object('body',body,'row_version',row_version,'updated_at',updated_at)),'{}') into sheets from public.kpi_daily_records where project_id=p_project_id and record_date=p_month and record_kind in ('STAGE_1','STAGE_2','STAGE_3');
 select jsonb_build_object('body',body,'row_version',row_version,'updated_at',updated_at) into goals from public.kpi_daily_records where project_id=p_project_id and record_date=p_month and record_kind='GOALS';
 return result||jsonb_build_object('stage_sheets',sheets,'goals',goals);
end $$;
revoke all on function private.read_kpi_daily(bigint,date),private.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid) from public,anon;
grant execute on function private.read_kpi_daily(bigint,date),private.save_kpi_daily(bigint,text,date,jsonb,bigint,uuid) to authenticated;
-- Rebind the public wrappers to the extended, authorized entry points.
create or replace function public.read_kpi_daily(p_project_id bigint,p_month date) returns jsonb language sql security invoker set search_path='' as $$ select private.read_kpi_daily(p_project_id,p_month) $$;
create or replace function public.save_kpi_daily(p_project_id bigint,p_kind text,p_date date,p_body jsonb,p_expected_version bigint,p_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.save_kpi_daily(p_project_id,p_kind,p_date,p_body,p_expected_version,p_mutation_id) $$;
commit;
