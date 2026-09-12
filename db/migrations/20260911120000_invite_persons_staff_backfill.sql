-- PR C follow-up — backfill persons + staff rows for memberships
-- created before lib/services/staff-invitations.ts:inviteStaff
-- learned to insert them, and before db/tenant-invite.ts:inviteOwner
-- had a fullName / staffType path.
--
-- Without this migration, every existing tenant_memberships row
-- pre-#122 has a tenant user but no persons row. Phase 3.6's audit
-- found this: a coach who existed only as tenant_memberships +
-- users could not be assigned to a batch, because batches.coach_id
-- is a real FK to staff.id and the coach had no staff row.
--
-- The forward path (Phase 3.6 onward) fixes every new invite:
-- lib/services/staff-invitations.ts:inviteStaff + the new shared
-- helper db/invite-helpers.ts:ensurePersonAndStaff create persons +
-- (where staffType applies) staff rows in the same transaction as
-- the membership. Existing rows from before that fix have nothing.
--
-- The backfill walks every tenant_memberships row that:
--   1. has a role with a known key (owner / admin / accountant /
--      receptionist / coach), AND
--   2. has a corresponding users row (every membership has one),
--      AND
--   3. has no persons row keyed to (tenant_id, user_id) via users.
--
-- (We use users.person_id as the linkage signal. PR C's helper
-- writes personId onto users at invite time; pre-fix rows have
-- users.person_id = NULL, which is the trigger.)
--
-- For each missing row, the migration:
--   1. Inserts a persons row. The fullName is derived from the
--      users.phone ("Owner +••• 1234", "Coach +••• 1234", etc.) —
--      a phone-suffixed placeholder. We deliberately do NOT pull a
--      real name from anywhere — there isn't one to pull. Operators
--      who care about the actual name can edit it via the existing
--      member-edit / staff-edit surfaces (InlineEditField on
--      /owner/members/[id], /owner/staff/[id]).
--   2. Updates users.person_id to point at the new persons row.
--   3. For coach / receptionist (the two STAFF_INVITABLE_ROLES in
--      lib/services/staff-invitations.ts that map to a staffType),
--      inserts a staff row keyed at (tenant_id, person_id,
--      staffType), then sets staff.user_id to the membership's
--      user_id. The unique index staff_tenant_person_type_key
--      (db/schema/staff.ts) covers the (tenant_id, person_id,
--      staff_type) unique constraint, so on conflict do nothing
--      keeps this idempotent.
--
-- Why no `down` migration: forward-only per CLAUDE.md. The next
-- person who needs it documents it in the file header.
--
-- Run time on the demo-academy seed tenant: one insert +
-- one update + one insert + one update per missing membership.
-- On a fresh DB this is a no-op (everything post-Phase 3.6 is
-- already correct). On an existing production tenant with N
-- memberships, the migration adds at most 2N rows to persons +
-- N rows to staff.

-- Step 1: persons rows for every membership whose user has no
-- person_id. The placeholder fullName is keyed on role key +
-- phone's last four digits so multiple memberships under the
-- same phone get distinct, recognisable rows.
--
-- id is generated server-side via gen_random_uuid() because raw
-- SQL bypasses the Drizzle $defaultFn on persons.id.
with inserted_persons as (
  insert into persons (id, tenant_id, full_name, created_by, updated_by)
  select gen_random_uuid(),
         m.tenant_id,
         r.key || ' +••• ' || right(regexp_replace(u.phone, '\D', '', 'g'), 4),
         m.created_by,
         m.created_by
  from tenant_memberships m
  join roles r on r.id = m.role_id
  join users u on u.id = m.user_id
  where m.status in ('invited', 'active')
    and u.person_id is null
    and m.deleted_at is null
  returning id, tenant_id, full_name
)

-- Step 2: link every users row to its just-created persons row.
-- The natural join (users.id ↔ m.user_id ↔ p.fullName) is enough:
-- Step 1's WHERE clause ensures u.person_id IS NULL, so each
-- users row matches at most one persons row. CTE-anchored so
-- the same insert feeds both the returning set and the update.
update users u
set person_id = ip.id
from inserted_persons ip,
     tenant_memberships m,
     roles r
where m.user_id = u.id
  and m.status in ('invited', 'active')
  and m.deleted_at is null
  and r.id = m.role_id
  and ip.tenant_id = m.tenant_id
  and ip.full_name = r.key || ' +••• ' || right(regexp_replace(u.phone, '\D', '', 'g'), 4)
  and u.person_id is null;

-- Step 3: staff rows for coach / receptionist. STAFF_INVITABLE_ROLES
-- in lib/services/staff-invitations.ts maps exactly to these two
-- roles; the join mirrors the STAFF_TYPE_FOR_ROLE table from that
-- file. Idempotent: a NOT EXISTS guard against the partial unique
-- index staff_tenant_person_type_key keeps this a no-op on re-runs
-- and against any tenant where the row already landed. The
-- staff_id_tenant_key constraint (the only regular UNIQUE on
-- staff) cannot drive ON CONFLICT here — the column order
-- (tenant_id, person_id, staff_type) is not a regular UNIQUE
-- index, just a partial one with a deleted_at IS NULL predicate.
insert into staff (id, tenant_id, person_id, user_id, staff_type, created_by, updated_by)
select gen_random_uuid(),
       m.tenant_id,
       u.person_id,
       m.user_id,
       case r.key
         when 'coach' then 'coach'
         when 'receptionist' then 'receptionist'
       end,
       m.created_by,
       m.created_by
from tenant_memberships m
join roles r on r.id = m.role_id
join users u on u.id = m.user_id
where m.status in ('invited', 'active')
  and m.deleted_at is null
  and r.key in ('coach', 'receptionist')
  and u.person_id is not null
  and not exists (
    select 1 from staff s
    where s.tenant_id = m.tenant_id
      and s.person_id = u.person_id
      and s.staff_type = case r.key
                            when 'coach' then 'coach'::text
                            when 'receptionist' then 'receptionist'::text
                          end
      and s.deleted_at is null
  );