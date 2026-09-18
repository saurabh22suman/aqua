-- 20260918125000_u06_announcements
--
-- U-06 (Release 1 UI closure) — announcements and the in-app
-- notification fan-out. Channel is in-app only in Release 1; the
-- WhatsApp provider stays the C-40a mock (see implementation-plan.md
-- U-06 and the gateway decision of 2026-09-14).
--
-- Shape decisions:
--   * `announcements` is the message the owner composed; `sent_at`
--     is set at fan-out time (a draft column is not modelled — the
--     composer sends, it does not schedule; C-47 scheduling is out
--     of scope).
--   * `audience` is `all | batch | parents`; `batch_id` is required
--     exactly when audience = 'batch' (check constraint below) so a
--     batch announcement can never point at nothing.
--   * `notifications` is one row per recipient user. `read_at` is
--     the per-user read state. `announcement_id` is nullable because
--     system notifications (future) may not originate from an
--     announcement.
--   * Both tables RLS-forced with the standard nullif policy.
--     notifications carries UPDATE only for `read_at`; no DELETE
--     grant on either table — sent messages are not retractable in
--     the surface (a corrected announcement is a new announcement).
--   * Tenant-leading indexes: announcements (tenant_id, sent_at
--     desc); notifications (tenant_id, user_id, created_at desc)
--     for the per-user inbox, plus (tenant_id, announcement_id)
--     for the sent-count subquery.

create table announcements (
  id         uuid not null,                -- UUIDv7, generated app-side
  tenant_id  uuid not null references tenants(id) on delete cascade,
  title      text not null,
  body       text not null,
  audience   text not null,
  batch_id   uuid,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint announcements_title_check
    check (char_length(btrim(title)) between 1 and 160),
  constraint announcements_body_check
    check (char_length(btrim(body)) between 1 and 4000),
  constraint announcements_audience_check
    check (audience in ('all', 'batch', 'parents')),
  constraint announcements_batch_check
    check ((audience = 'batch') = (batch_id is not null)),
  constraint announcements_id_tenant_key unique (id, tenant_id),
  constraint announcements_batch_tenant_fkey
    foreign key (batch_id, tenant_id) references batches (id, tenant_id)
);

create index announcements_tenant_sent_idx
  on announcements (tenant_id, sent_at desc, created_at desc);

alter table announcements enable row level security;
alter table announcements force row level security;

create policy tenant_isolation on announcements
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert on announcements to app_user;

create table notifications (
  id              uuid not null,           -- UUIDv7, generated app-side
  tenant_id       uuid not null references tenants(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  announcement_id uuid,
  title           text not null,
  body            text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint notifications_id_tenant_key unique (id, tenant_id),
  constraint notifications_announcement_tenant_fkey
    foreign key (announcement_id, tenant_id)
    references announcements (id, tenant_id)
);

create index notifications_tenant_user_idx
  on notifications (tenant_id, user_id, created_at desc);

create index notifications_tenant_announcement_idx
  on notifications (tenant_id, announcement_id);

alter table notifications enable row level security;
alter table notifications force row level security;

create policy tenant_isolation on notifications
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on notifications to app_user;

-- U-07 — register the business-hours key here, not in a third
-- migration: this workstream owns exactly these two migration files,
-- and a fresh deployment reaches config_keys only through migrations
-- (db/deploy.ts does not run seed-platform). The code catalogue
-- (db/config-definitions.ts) remains the source of truth; the seed
-- upsert re-asserts this row on every seed run, so drift is visible,
-- never silent. `{days: []}` is the honest "not configured" default.
insert into config_keys (key, value_schema, default_value, visibility, risk, description)
values (
  'operations.business_hours',
  '{"type":"object","required":["days"],"properties":{"days":{"type":"array","maxItems":7,"items":{"type":"object","required":["day","closed","open","close"],"properties":{"day":{"enum":["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]},"closed":{"type":"boolean"},"open":{"type":"string","pattern":"^([01]\\d|2[0-3]):[0-5]\\d$"},"close":{"type":"string","pattern":"^([01]\\d|2[0-3]):[0-5]\\d$"}}}}}}'::jsonb,
  '{"days":[]}'::jsonb,
  'owner_edit',
  'safe',
  'Opening and closing times per day for a location. Empty means not configured yet.'
)
on conflict (key) do nothing;
