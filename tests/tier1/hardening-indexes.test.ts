import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";

// H-01 — the 2026-09-18 schema-audit index gap. Introspects the live
// schema (migrations applied) and asserts each audited index exists
// with the exact definition the audit asked for. Written before the
// migration: every assertion below is red until
// db/migrations/20260918050000_h01_hardening_indexes.sql lands.
//
// Deviations from the task's literal column list are deliberate and
// carry the tenant-leading convention the H-02 scan enforces:
//   batches(program_id)          -> (tenant_id, program_id)
//   batches(coach_id)            -> (tenant_id, coach_id)
//   sessions(coach_id)           -> (tenant_id, coach_id)
//   enrolments(batch_id)         -> (tenant_id, batch_id)
//   members(person_id)           -> (tenant_id, person_id)
//   staff(user_id)               -> (tenant_id, user_id)
//   guardianships(guardian_id)   -> (tenant_id, guardian_id)
// The two pre-tenant lookups the audit found stay bare on purpose
// (no tenant context exists at resolution time): tenant_memberships
// (user_id) live+active and message_log(provider_message_id) webhook
// dedupe. Both are exempted, with reasons, in
// scripts/lib/tenant-conventions-scan.ts.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

afterAll(async () => {
  await admin.end();
});

type ExpectedIndex = { name: string; indexdef: string };

const EXPECTED: ExpectedIndex[] = [
  {
    name: "attendance_tenant_member_marked_idx",
    indexdef:
      "CREATE INDEX attendance_tenant_member_marked_idx ON public.attendance USING btree (tenant_id, member_id, marked_at DESC)",
  },
  {
    name: "tenant_memberships_user_live_idx",
    indexdef:
      "CREATE INDEX tenant_memberships_user_live_idx ON public.tenant_memberships USING btree (user_id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text))",
  },
  {
    name: "ba_session_user_id_idx",
    indexdef:
      "CREATE INDEX ba_session_user_id_idx ON public.ba_session USING btree (user_id)",
  },
  {
    name: "ba_account_user_id_idx",
    indexdef:
      "CREATE INDEX ba_account_user_id_idx ON public.ba_account USING btree (user_id)",
  },
  {
    name: "ba_verification_identifier_idx",
    indexdef:
      "CREATE INDEX ba_verification_identifier_idx ON public.ba_verification USING btree (identifier)",
  },
  {
    name: "programs_tenant_idx",
    indexdef:
      "CREATE INDEX programs_tenant_idx ON public.programs USING btree (tenant_id)",
  },
  {
    name: "batches_tenant_program_idx",
    indexdef:
      "CREATE INDEX batches_tenant_program_idx ON public.batches USING btree (tenant_id, program_id)",
  },
  {
    name: "batches_tenant_coach_idx",
    indexdef:
      "CREATE INDEX batches_tenant_coach_idx ON public.batches USING btree (tenant_id, coach_id)",
  },
  {
    name: "sessions_tenant_coach_idx",
    indexdef:
      "CREATE INDEX sessions_tenant_coach_idx ON public.sessions USING btree (tenant_id, coach_id)",
  },
  {
    name: "enrolments_tenant_batch_idx",
    indexdef:
      "CREATE INDEX enrolments_tenant_batch_idx ON public.enrolments USING btree (tenant_id, batch_id)",
  },
  {
    name: "members_tenant_person_idx",
    indexdef:
      "CREATE INDEX members_tenant_person_idx ON public.members USING btree (tenant_id, person_id)",
  },
  {
    name: "staff_tenant_user_idx",
    indexdef:
      "CREATE INDEX staff_tenant_user_idx ON public.staff USING btree (tenant_id, user_id)",
  },
  {
    name: "guardianships_tenant_guardian_idx",
    indexdef:
      "CREATE INDEX guardianships_tenant_guardian_idx ON public.guardianships USING btree (tenant_id, guardian_id)",
  },
  {
    name: "payments_tenant_location_received_idx",
    indexdef:
      "CREATE INDEX payments_tenant_location_received_idx ON public.payments USING btree (tenant_id, location_id, received_at)",
  },
  {
    name: "message_log_provider_message_idx",
    indexdef:
      "CREATE INDEX message_log_provider_message_idx ON public.message_log USING btree (provider_message_id)",
  },
  {
    name: "message_log_tenant_status_created_idx",
    indexdef:
      "CREATE INDEX message_log_tenant_status_created_idx ON public.message_log USING btree (tenant_id, status, created_at)",
  },
  {
    name: "platform_audit_log_action_idx",
    indexdef:
      "CREATE INDEX platform_audit_log_action_idx ON public.platform_audit_log USING btree (action)",
  },
];

describe("H-01 hardening indexes", () => {
  it("every audited index exists with the exact expected definition (pg_indexes)", async () => {
    const { rows } = await admin.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and indexname = any($1::text[])`,
      [EXPECTED.map((e) => e.name)],
    );
    const actual = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const mismatches = EXPECTED.filter(
      (e) => actual.get(e.name) !== e.indexdef,
    ).map((e) => ({
      index: e.name,
      expected: e.indexdef,
      actual: actual.get(e.name) ?? null,
    }));
    expect(mismatches).toEqual([]);
  });
});
