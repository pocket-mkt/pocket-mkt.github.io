-- Keep existing progress-only customers restricted to safe shared surfaces.
-- No membership mutation or internal-page grant is needed for published reports.
create or replace function private.assert_monthly_report_access(p_project_id bigint, p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare internal boolean;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode='42501'; end if;
  internal := private.can_read_project(p_project_id,'PROJECT_TEAM',null);
  if not internal and not (
    private.can_read_project(p_project_id,'CLIENT','performance') or
    private.can_read_project(p_project_id,'CLIENT','progress') or
    private.can_read_project(p_project_id,'CLIENT','tasks')
  ) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_write and (not internal or not private.can_write_project(p_project_id)) then raise exception 'forbidden' using errcode='42501'; end if;
  return internal;
end $$;
revoke all on function private.assert_monthly_report_access(bigint,boolean) from public,anon,authenticated;
