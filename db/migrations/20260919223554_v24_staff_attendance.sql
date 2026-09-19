-- 20260919223554_v24_staff_attendance
--
-- V-24 (Phase 3B, staff attendance and pay) — staff_attendance, per
-- docs/implementation-plan.md V-24 and architecture.md §8.9.
--
-- Shape decisions:
--   * one row per staff member per work_date (`unique (tenant_id,
--     staff_id, work_date)`): a day is present/absent/leave once, not
--     once per shift. `shift_id` links the shift the late minutes were
--     measured against, when one exists.
--   * `late_minutes` is computed at check-in against the day's first
--     shift (lib/services/staff-attendance.ts) and stored, not derived
--     on read — a later roster edit must not silently rewrite history.
--   * `method` is self_app | self_qr | manual. `marked_by` is the
--     correcting staff member and is set if and only if method is
--     manual — the CHECK below makes the "who corrected this"
--     question impossible to lose.
--   * `note` carries the correction reason; the service refuses a
--     manual correction without one (V-24 done-when: a manual
--     correction records who made it and why).
--   * `client_id` is the idempotency key for the future offline sync
--     path, mirroring member attendance.
--   * composite (id, tenant_id) FKs + tenant-leading indexes, RLS
--     enable + force, standard nullif tenant_isolation policy.

create table staff_attendance (
  id              uuid not null,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  staff_id        uuid not null,
  shift_id        uuid,
  work_date       date not null,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  method          text not null,
  marked_by       uuid,
  late_minutes    int not null default 0,
  status          text not null,
  note            text,
  client_id       text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint staff_attendance_id_tenant_key unique (id, tenant_id),
  constraint staff_attendance_staff_day_key unique (tenant_id, staff_id, work_date),
  constraint staff_attendance_method_check
    check (method in ('self_app', 'self_qr', 'manual')),
  constraint staff_attendance_status_check
    check (status in ('present', 'absent', 'half_day', 'leave', 'holiday')),
  constraint staff_attendance_late_check check (late_minutes >= 0),
  constraint staff_attendance_checkout_check
    check (checked_out_at is null or checked_in_at is not null),
  constraint staff_attendance_marked_by_check
    check ((method = 'manual') = (marked_by is not null)),
  constraint staff_attendance_note_check
    check (note is null or char_length(note) <= 500),
  constraint staff_attendance_staff_tenant_fkey
    foreign key (staff_id, tenant_id) references staff (id, tenant_id),
  constraint staff_attendance_marked_by_tenant_fkey
    foreign key (marked_by, tenant_id) references staff (id, tenant_id),
  constraint staff_attendance_shift_tenant_fkey
    foreign key (shift_id, tenant_id) references shifts (id, tenant_id)
);

create index staff_attendance_tenant_date_staff_idx
  on staff_attendance (tenant_id, work_date, staff_id);

alter table staff_attendance enable row level security;
alter table staff_attendance force row level security;

create policy tenant_isolation on staff_attendance
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on staff_attendance to app_user;
