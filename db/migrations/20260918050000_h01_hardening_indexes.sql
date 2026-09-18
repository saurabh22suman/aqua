-- 20260918050000_h01_hardening_indexes
--
-- H-01 (Release 1 hardening) — the missing indexes from the
-- 2026-09-18 schema audit: the member, tenant-resolution,
-- reconciliation and webhook-dedupe hot paths. Additive only; no
-- table or policy changes.
--
-- Tenant tables lead with tenant_id — the convention H-02 codifies
-- and scripts/check-tenant-conventions.ts enforces for migrations
-- from this timestamp on. The audit's bare-column forms were folded
-- into tenant-leading ones where tenant context is always present
-- (batches, sessions, enrolments, members, staff, guardianships).
--
-- Two indexes intentionally do NOT lead with tenant_id, because the
-- lookups they serve run before a tenant is selected:
--   * tenant_memberships (user_id)      — withUser()/user_resolution
--   * message_log (provider_message_id) — provider webhook dedupe
-- Both are exempted, with reasons, in
-- scripts/lib/tenant-conventions-scan.ts.
--
-- `concurrently` is not used: db/migrate.ts wraps each migration file
-- in a transaction, and CREATE INDEX CONCURRENTLY cannot run inside
-- one. Every table here is small enough that a plain build is
-- acceptable — matching every existing migration in this directory.

-- attendance: member history ("this member's marks, most recent
-- first") — the member page and the absence-alert job both scan it.
create index attendance_tenant_member_marked_idx
  on attendance (tenant_id, member_id, marked_at desc);

-- tenant_memberships: pre-tenant user resolution (withUser()); a
-- tenant-leading index cannot serve a lookup that has no tenant yet.
-- Partial live+active is more selective than deleted_at alone and
-- matches the rows the resolver actually reads.
create index tenant_memberships_user_live_idx
  on tenant_memberships (user_id)
  where deleted_at is null and status = 'active';

-- better-auth session/account/verification lookups (platform tables,
-- no tenant scope).
create index ba_session_user_id_idx on ba_session (user_id);
create index ba_account_user_id_idx on ba_account (user_id);
create index ba_verification_identifier_idx on ba_verification (identifier);

-- programs/batches/sessions: coach assignment and program roll-ups.
create index programs_tenant_idx on programs (tenant_id);
create index batches_tenant_program_idx on batches (tenant_id, program_id);
create index batches_tenant_coach_idx on batches (tenant_id, coach_id);
create index sessions_tenant_coach_idx on sessions (tenant_id, coach_id);

-- enrolments: batch roster reads.
create index enrolments_tenant_batch_idx on enrolments (tenant_id, batch_id);

-- members/persons: person-to-member resolution (one person, one
-- member row per tenant).
create index members_tenant_person_idx on members (tenant_id, person_id);

-- staff: staff record for a user (coach identity on the session and
-- batch surfaces).
create index staff_tenant_user_idx on staff (tenant_id, user_id);

-- guardianships: a guardian's children.
create index guardianships_tenant_guardian_idx
  on guardianships (tenant_id, guardian_id);

-- payments: the daily collection report filters location and orders
-- by receipt time.
create index payments_tenant_location_received_idx
  on payments (tenant_id, location_id, received_at);

-- message_log: webhook dedupe by provider id (pre-tenant, exempt —
-- see the header), and the tenant status feed.
create index message_log_provider_message_idx
  on message_log (provider_message_id);
create index message_log_tenant_status_created_idx
  on message_log (tenant_id, status, created_at);

-- platform_audit_log: operator activity filtered by action.
create index platform_audit_log_action_idx on platform_audit_log (action);
