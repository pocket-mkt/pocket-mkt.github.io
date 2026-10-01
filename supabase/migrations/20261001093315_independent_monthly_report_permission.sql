-- Separate customer report access from task/progress/KPI page grants.
-- Preserve existing effective report access once, without granting new pages.
alter table public.project_memberships
  add constraint project_memberships_allowed_pages_reports_check
  check (allowed_pages <@ array['overview','plan','tasks','progress','daily','content','tracking','performance','files','reports']::text[]) not valid;
alter table public.project_memberships validate constraint project_memberships_allowed_pages_reports_check;
alter table public.project_memberships drop constraint project_memberships_allowed_pages_check;
alter table public.project_memberships rename constraint project_memberships_allowed_pages_reports_check to project_memberships_allowed_pages_check;

update public.project_memberships m
set allowed_pages=array_append(m.allowed_pages,'reports')
where not ('reports'=any(m.allowed_pages))
  and m.allowed_pages && array['tasks','progress','performance']::text[]
  and exists (select 1 from public.profiles p where p.id=m.user_id and p.organization_code='CLIENT' and p.role_code='CLIENT_VIEWER');

create or replace function private.assert_monthly_report_access(p_project_id bigint, p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare internal boolean;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode='42501'; end if;
  internal := private.can_read_project(p_project_id,'PROJECT_TEAM',null);
  if not internal and not private.can_read_project(p_project_id,'CLIENT','reports') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_write and (not internal or not private.can_write_project(p_project_id)) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return internal;
end $$;
revoke all on function private.assert_monthly_report_access(bigint,boolean) from public,anon,authenticated;
