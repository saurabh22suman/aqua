-- C-29c (2026-09-14 reshuffle) — plans price per facility, optionally
-- per activity, and GST is no longer a per-plan column.
--
-- A plan belongs to exactly one location (facility); activity_id is
-- optional (null = all-access / combo). Prices stay GST-exclusive; the
-- rate comes from billing.gst_rate_bp resolved at invoice time.
--
-- Subscriptions copy location_id/activity_id from their plan at
-- creation so per-site billing queries do not depend on the plan row
-- (the same events-carry-location rule as O-02).

alter table membership_plans add column location_id uuid;
alter table membership_plans add column activity_id uuid;

-- Backfill existing plans to the tenant's primary location (O-01's
-- invariant guarantees one for non-churned tenants).
update membership_plans p
   set location_id = (
     select l.id
       from locations l
      where l.tenant_id = p.tenant_id
        and l.deleted_at is null
      order by l.is_primary desc, l.created_at asc, l.id asc
      limit 1
   )
 where p.location_id is null;

alter table membership_plans alter column location_id set not null;

alter table membership_plans
  add constraint membership_plans_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id);

alter table membership_plans
  add constraint membership_plans_activity_tenant_fkey
  foreign key (activity_id, tenant_id) references facilities (id, tenant_id);

-- One live plan per template per (facility, activity): a template can
-- be priced independently at each site, and an all-access plan (null
-- activity) is distinct from any activity-specific one.
drop index membership_plans_shape_live_uidx;
create unique index membership_plans_shape_live_uidx
  on membership_plans (
    tenant_id,
    location_id,
    coalesce(activity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_shape_id
  )
  where deleted_at is null and source_shape_id is not null;

create index membership_plans_tenant_location_live_idx
  on membership_plans (tenant_id, location_id, activity_id)
  where deleted_at is null;

-- GST now lives in the config registry (billing.gst_rate_bp), scoped
-- per facility/activity; a per-plan rate would be a second source of
-- truth.
alter table membership_plans drop column tax_rate_bp;

-- Subscriptions carry the facility + activity of the plan they bought.
alter table subscriptions add column location_id uuid;
alter table subscriptions add column activity_id uuid;

update subscriptions s
   set location_id = p.location_id,
       activity_id = p.activity_id
  from membership_plans p
 where p.id = s.plan_id
   and p.tenant_id = s.tenant_id;

alter table subscriptions alter column location_id set not null;

alter table subscriptions
  add constraint subscriptions_location_tenant_fkey
  foreign key (location_id, tenant_id) references locations (id, tenant_id);

alter table subscriptions
  add constraint subscriptions_activity_tenant_fkey
  foreign key (activity_id, tenant_id) references facilities (id, tenant_id);

create index subscriptions_tenant_location_idx
  on subscriptions (tenant_id, location_id)
  where status = 'active';
