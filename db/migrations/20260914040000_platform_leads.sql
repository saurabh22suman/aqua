-- O-09 (docs/ops-platform-design.md §7) — platform_leads.
--
-- A sales lead is a club approaching the platform, not a parent
-- approaching a club. It is platform-scoped: no tenant_id until
-- conversion, and no RLS (db/allowlist.ts lists it as a platform
-- table). It holds real names and phone numbers, so direct imports are
-- restricted by scripts/check-platform-leads-imports.ts to the service,
-- the ops console action and the ops console UI.

create table platform_leads (
  id                  uuid primary key default gen_random_uuid(),
  business_name       text not null,
  contact_name        text not null,
  phone               text not null,
  email               text,
  city                text,
  source              text not null
                      check (source in ('website', 'phone', 'whatsapp', 'referral', 'other')),
  status              text not null default 'lead'
                      check (status in ('lead', 'qualified', 'demo_booked', 'trial', 'converted', 'lapsed', 'lost')),
  -- Structured qualification answers captured during the sales
  -- conversation (sport, member-count band, fee model, collection mode,
  -- GST registered, coach count, locations). O-10 converts these into
  -- the tenant's initial configuration instead of re-asking them.
  qualification       jsonb not null default '{}'::jsonb,
  trial_tenant_id     uuid references tenants(id) on delete set null,
  trial_starts_at     timestamptz,
  trial_expires_at    timestamptz,
  ops_owner_id        uuid references platform_users(id) on delete set null,
  lost_reason         text,
  converted_tenant_id uuid references tenants(id) on delete set null,
  converted_at        timestamptz,
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Lost-reason data is the only honest input to the pricing question;
  -- a lost lead without one is not a record, it's a dead end.
  constraint platform_leads_lost_reason_check
    check (status <> 'lost' or lost_reason is not null)
);

create index platform_leads_status_idx
  on platform_leads (status, created_at desc);

create index platform_leads_phone_idx
  on platform_leads (phone);

grant select, insert, update, delete on platform_leads to app_user;
