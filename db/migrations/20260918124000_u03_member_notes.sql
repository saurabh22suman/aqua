-- 20260918124000_u03_member_notes
--
-- U-03 (Release 1 UI closure) — member notes. An internal, audited
-- note attached to a member's 360 page: "called about the missed
-- session", "doctor's note on file". Notes are staff-authored,
-- never member-facing.
--
-- Shape decisions:
--   * `id` UUIDv7 generated app-side (H-02 convention).
--   * `body` non-empty after trim, capped at 4000 chars — a note is
--     prose, not a document; the cap keeps the row and the audit
--     snapshot bounded.
--   * soft delete only (`deleted_at`): an author may remove a note
--     from the surface, but the audit trail and the row survive.
--   * author is `created_by` / `updated_by` (the tenant user id),
--     matching the auditColumns convention.
--   * RLS: enable + force, the standard nullif tenant_isolation
--     policy; app_user gets full DML (notes are editable, unlike
--     append-only audit tables).
--   * tenant-leading index: (tenant_id, member_id, created_at desc),
--     partial on live rows — exactly the member-detail read path.

create table member_notes (
  id         uuid not null,                -- UUIDv7, generated app-side
  tenant_id  uuid not null references tenants(id) on delete cascade,
  member_id  uuid not null,
  body       text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint member_notes_body_check
    check (char_length(btrim(body)) between 1 and 4000),
  constraint member_notes_id_tenant_key unique (id, tenant_id),
  constraint member_notes_member_tenant_fkey
    foreign key (member_id, tenant_id) references members (id, tenant_id)
);

create index member_notes_tenant_member_live_idx
  on member_notes (tenant_id, member_id, created_at desc)
  where deleted_at is null;

alter table member_notes enable row level security;
alter table member_notes force row level security;

create policy tenant_isolation on member_notes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on member_notes to app_user;
