import type { Pool } from "pg";

// E-03's append-only guard (db/migrations/20260918095000_e03_audit_guard.sql)
// raises on every UPDATE and DELETE against audit_log, for every role —
// including the privileged migration pool. Fixture cleanup therefore
// cannot simply `delete from audit_log`, which is exactly the point of
// the guard.
//
// This is the TEST-ONLY escape hatch for that guard: each delete wraps
// itself in `alter table audit_log disable trigger audit_log_no_mutate`
// and re-enables the trigger in a `finally`. It must NEVER be used in
// application code — production code has no legitimate reason to
// delete audit rows, and reaching for this helper outside tests is the
// same as disabling the tamper tripwire by hand.
//
// The trigger lives on the partitioned parent (H-03 rebuilt audit_log
// as monthly range partitions); disabling it there covers every
// partition, so never disable triggers on individual partitions.

const AUDIT_TABLE = "audit_log";
const MUTATION_GUARD_TRIGGER = "audit_log_no_mutate";

/**
 * Delete audit rows matching an arbitrary SQL predicate, stepping
 * around the E-03 append-only trigger for the duration of the delete.
 *
 * `whereSql` is a predicate fragment (no `where` keyword) and
 * `params` are its `$n` bindings. Only test cleanup should call this.
 */
export async function deleteAuditRows(
  admin: Pool,
  whereSql: string,
  params: unknown[],
): Promise<void> {
  await admin.query(
    `alter table ${AUDIT_TABLE} disable trigger ${MUTATION_GUARD_TRIGGER}`,
  );
  try {
    await admin.query(
      `delete from ${AUDIT_TABLE} where ${whereSql}`,
      params,
    );
  } finally {
    await admin.query(
      `alter table ${AUDIT_TABLE} enable trigger ${MUTATION_GUARD_TRIGGER}`,
    );
  }
}

/**
 * Delete every audit row for one tenant, stepping around the E-03
 * append-only trigger for the duration of the delete. Test cleanup
 * only.
 */
export async function deleteAuditRowsForTenant(
  admin: Pool,
  tenantId: string,
): Promise<void> {
  await deleteAuditRows(admin, "tenant_id = $1::uuid", [tenantId]);
}
