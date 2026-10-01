begin;
-- Standalone HTML reports are small authenticated documents, not public URLs.
-- Existing performance grants cover both KPI and monthly reports; no grants expand.
create table public.monthly_marketing_reports (
  project_id bigint not null references public.projects(id),
  month date not null check (extract(day from month)=1 and month between '2000-01-01' and '2100-12-01'),
  title text not null check (length(trim(title)) between 1 and 160),
  file_name text not null check (length(file_name) between 1 and 200 and file_name ~* '\.html?$'),
  html text not null check (octet_length(html) between 1 and 3145728),
  published boolean not null default false,
  row_version bigint not null default 1 check (row_version>0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  archived_at timestamptz,
  primary key(project_id,month)
);
create index monthly_reports_updated_by on public.monthly_marketing_reports(updated_by);
alter table public.monthly_marketing_reports enable row level security;
revoke all on public.monthly_marketing_reports from public,anon,authenticated;
create table private.monthly_report_audit (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id),
  month date not null,
  actor_id uuid not null references auth.users(id),
  mutation_id uuid not null,
  request_signature jsonb not null,
  action text not null check (action in ('CREATED','UPDATED','ARCHIVED')),
  title text not null, file_name text not null, published boolean not null,
  row_version bigint not null, occurred_at timestamptz not null default now(),
  unique(project_id,mutation_id)
);
create index monthly_report_audit_actor on private.monthly_report_audit(actor_id);
alter table private.monthly_report_audit enable row level security;
revoke all on private.monthly_report_audit from public,anon,authenticated;

create function private.assert_monthly_report_access(p_project_id bigint, p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare internal boolean;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode='42501'; end if;
  internal := private.can_read_project(p_project_id,'PROJECT_TEAM',null);
  if not internal and not private.can_read_project(p_project_id,'CLIENT','performance') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_write and (not internal or not private.can_write_project(p_project_id)) then raise exception 'forbidden' using errcode='42501'; end if;
  return internal;
end $$;
revoke all on function private.assert_monthly_report_access(bigint,boolean) from public,anon,authenticated;

create function private.list_monthly_reports(p_project_id bigint,p_before_month date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare internal boolean; items jsonb; extra_month date;
begin
  internal := private.assert_monthly_report_access(p_project_id);
  if p_before_month is not null and extract(day from p_before_month)<>1 then raise exception 'invalid_month' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.month desc),'[]'::jsonb) into items from (
    select month,title,file_name,published,row_version,updated_at from public.monthly_marketing_reports
    where project_id=p_project_id and archived_at is null and (internal or published)
      and (p_before_month is null or month<p_before_month)
    order by month desc limit 120
  ) r;
  select month into extra_month from public.monthly_marketing_reports
    where project_id=p_project_id and archived_at is null and (internal or published)
      and (p_before_month is null or month<p_before_month)
    order by month desc offset 120 limit 1;
  return jsonb_build_object('items',items,'canWrite',internal and private.can_write_project(p_project_id),'nextMonth',case when extra_month is not null then (items->-1->>'month') else null end);
end $$;
create function private.read_monthly_report(p_project_id bigint,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare internal boolean; r public.monthly_marketing_reports%rowtype;
begin
  internal := private.assert_monthly_report_access(p_project_id);
  if p_month is null or extract(day from p_month)<>1 then raise exception 'invalid_month' using errcode='22023'; end if;
  select * into r from public.monthly_marketing_reports where project_id=p_project_id and month=p_month and archived_at is null and (internal or published);
  return jsonb_build_object('item',case when found then jsonb_build_object('month',r.month,'title',r.title,'file_name',r.file_name,'published',r.published,'row_version',r.row_version,'updated_at',r.updated_at,'html',r.html) else null end);
end $$;
create function private.save_monthly_report(p_project_id bigint,p_month date,p_title text,p_file_name text,p_html text,p_published boolean,p_expected_version bigint,p_mutation_id uuid,p_operation text default 'SAVE') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.monthly_marketing_reports%rowtype; receipt private.monthly_report_audit%rowtype; signature jsonb; action_name text; existed boolean;
begin
  perform private.assert_monthly_report_access(p_project_id,true);
  if p_month is null or extract(day from p_month)<>1 or p_month not between '2000-01-01' and '2100-12-01' or p_mutation_id is null or p_operation not in ('SAVE','ARCHIVE') or p_operation is null then raise exception 'invalid_report_request' using errcode='22023'; end if;
  if p_operation='SAVE' and (p_title is null or length(trim(p_title)) not between 1 and 160 or p_file_name is null or length(p_file_name) not between 1 and 200 or p_file_name !~* '\.html?$' or p_html is null or octet_length(p_html) not between 1 and 3145728 or p_html !~* '<(html|body|head|div|section|main|article|h[1-6])([[:space:]>])' or p_published is null) then raise exception 'invalid_report_file' using errcode='22023'; end if;
  signature := jsonb_build_array(p_month,p_operation,p_title,p_file_name,md5(p_html),p_published);
  perform pg_advisory_xact_lock(hashtextextended('monthly_reports:'||p_project_id::text,0));
  select * into receipt from private.monthly_report_audit where project_id=p_project_id and mutation_id=p_mutation_id;
  if found then
    if receipt.actor_id<>auth.uid() or receipt.request_signature<>signature then raise exception 'mutation_reused' using errcode='22023'; end if;
    return jsonb_build_object('saved',true,'month',receipt.month,'row_version',receipt.row_version,'archived',receipt.action='ARCHIVED');
  end if;
  select * into r from public.monthly_marketing_reports where project_id=p_project_id and month=p_month for update;
  existed := found;
  if existed and p_expected_version is distinct from r.row_version and not (p_operation='SAVE' and r.archived_at is not null and p_expected_version is null) or not existed and p_expected_version is not null then raise exception 'stale_row_version' using errcode='40001'; end if;
  if p_operation='ARCHIVE' then
    if not existed or r.archived_at is not null then raise exception 'stale_row_version' using errcode='40001'; end if;
    update public.monthly_marketing_reports set archived_at=now(),published=false,row_version=row_version+1,updated_at=now(),updated_by=auth.uid() where project_id=p_project_id and month=p_month returning * into r;
    action_name := 'ARCHIVED';
  elsif existed then
    update public.monthly_marketing_reports set title=trim(p_title),file_name=p_file_name,html=p_html,published=p_published,archived_at=null,row_version=row_version+1,updated_at=now(),updated_by=auth.uid() where project_id=p_project_id and month=p_month returning * into r;
    action_name := 'UPDATED';
  else
    insert into public.monthly_marketing_reports(project_id,month,title,file_name,html,published,updated_by) values(p_project_id,p_month,trim(p_title),p_file_name,p_html,p_published,auth.uid()) returning * into r;
    action_name := 'CREATED';
  end if;
  insert into private.monthly_report_audit(project_id,month,actor_id,mutation_id,request_signature,action,title,file_name,published,row_version) values(p_project_id,p_month,auth.uid(),p_mutation_id,signature,action_name,r.title,r.file_name,r.published,r.row_version);
  return jsonb_build_object('saved',true,'month',r.month,'row_version',r.row_version,'archived',p_operation='ARCHIVE');
end $$;
revoke all on function private.list_monthly_reports(bigint,date),private.read_monthly_report(bigint,date),private.save_monthly_report(bigint,date,text,text,text,boolean,bigint,uuid,text) from public,anon;
grant execute on function private.list_monthly_reports(bigint,date),private.read_monthly_report(bigint,date),private.save_monthly_report(bigint,date,text,text,text,boolean,bigint,uuid,text) to authenticated;
create function public.list_monthly_reports(p_project_id bigint,p_before_month date default null) returns jsonb language sql security invoker set search_path='' as $$ select private.list_monthly_reports(p_project_id,p_before_month) $$;
create function public.read_monthly_report(p_project_id bigint,p_month date) returns jsonb language sql security invoker set search_path='' as $$ select private.read_monthly_report(p_project_id,p_month) $$;
create function public.save_monthly_report(p_project_id bigint,p_month date,p_title text,p_file_name text,p_html text,p_published boolean,p_expected_version bigint,p_mutation_id uuid,p_operation text default 'SAVE') returns jsonb language sql security invoker set search_path='' as $$ select private.save_monthly_report(p_project_id,p_month,p_title,p_file_name,p_html,p_published,p_expected_version,p_mutation_id,p_operation) $$;
revoke all on function public.list_monthly_reports(bigint,date),public.read_monthly_report(bigint,date),public.save_monthly_report(bigint,date,text,text,text,boolean,bigint,uuid,text) from public,anon;
grant execute on function public.list_monthly_reports(bigint,date),public.read_monthly_report(bigint,date),public.save_monthly_report(bigint,date,text,text,text,boolean,bigint,uuid,text) to authenticated;
commit;
