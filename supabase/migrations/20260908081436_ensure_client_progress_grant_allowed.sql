-- Compatibility with production databases where the earlier progress grant
-- migration was not recorded/applied. Preserve all existing page codes.
alter table public.project_memberships drop constraint project_memberships_allowed_pages_check;
alter table public.project_memberships add constraint project_memberships_allowed_pages_check
  check (allowed_pages <@ array['overview','plan','tasks','progress','daily','content','tracking','performance','files']::text[]);
