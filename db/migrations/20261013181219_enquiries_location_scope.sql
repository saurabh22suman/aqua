-- 20261013181219_enquiries_location_scope
--
-- 2026-10-13 role-workflow audit R04 — enquiries gain explicit site
-- ownership. Reception reads/acts only on enquiries at its allowed
-- locations; an enquiry whose location cannot be established stays
-- NULL and is visible only through the management review path
-- (settings.manage holders). Missing location never means unrestricted
-- access, and historical rows are never assigned to an arbitrary site.
--
-- Backfill rule: only where a reliable related resource carries a
-- location — the trial batch's site first, then the linked member's
-- site. Enquiries with neither stay unassigned.
--
-- Idempotent: column add is single-run by the migration runner; the
-- backfill only touches rows still NULL with a resolvable location,
-- and the FK is added once.

alter table enquiries add column location_id uuid;

update enquiries e
   set location_id = src.location_id
  from (
    select e2.id,
           coalesce(b.location_id, m.location_id) as location_id
      from enquiries e2
      left join batches b
        on b.id = e2.trial_batch_id
       and b.tenant_id = e2.tenant_id
      left join members m
        on m.id = e2.member_id
       and m.tenant_id = e2.tenant_id
  ) src
 where e.id = src.id
   and e.location_id is null
   and src.location_id is not null;

alter table enquiries
  add constraint enquiries_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id);

create index enquiries_tenant_location_live_idx
  on enquiries (tenant_id, location_id)
  where deleted_at is null;
