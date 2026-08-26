-- Roles must exist before memberships can reference them. Fixture tenants
-- have memberships but no roles, and `parent` is not an F-04 template.
-- gen_random_uuid() is v4, not the app-side uuidv7: plain SQL has no
-- uuidv7, and migrations stay plain SQL — accepted exception.
-- on conflict do nothing: tenants carrying F-04 templates keep their rows,
-- names and any edits.
insert into roles (id, tenant_id, key, name, is_system)
select gen_random_uuid(), d.tenant_id, d.role, initcap(d.role), d.role <> 'parent'
from (select distinct tenant_id, role from tenant_memberships) d
on conflict (tenant_id, key) do nothing;

alter table tenant_memberships add column role_id uuid;

update tenant_memberships m
set role_id = r.id
from roles r
where r.tenant_id = m.tenant_id and r.key = m.role;

-- Fail loudly: a silent partial backfill must never pass.
do $$
declare n int;
begin
  select count(*) into n from tenant_memberships where role_id is null;
  if n > 0 then
    raise exception 'role_id backfill incomplete: % membership(s) unmatched', n;
  end if;
end $$;

alter table tenant_memberships alter column role_id set not null;

-- Composite FK: a membership can never reference another tenant's role.
-- No on delete action — restrict is the default; a role in use must not be
-- deletable out from under a membership.
alter table tenant_memberships
  add constraint tenant_memberships_role_tenant_fkey
  foreign key (role_id, tenant_id) references roles (id, tenant_id);

-- Drops tenant_memberships_role_check along with it.
alter table tenant_memberships drop column role;
