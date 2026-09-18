import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { platformAuditLog } from "@/db/schema/platform-users";
import { eq } from "drizzle-orm";
import {
  buildCheckpointManifest,
  checkpointObjectKey,
  requireCheckpointSecret,
  selectAuditRowsForDay,
} from "@/lib/audit/checkpoint";
import {
  AUDIT_CHECKPOINT_ACTION,
  selectCheckpointAnchor,
} from "@/lib/audit/checkpoint-anchor";
import { getObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// E-03 — audit.checkpoint. Computes the previous tenant-local day's
// canonical audit digest, writes the manifest to the object store, and
// anchors the aggregate digest in platform_audit_log.
//
// Why the anchor: the object store is not transactional and can be
// disabled or unreachable; platform_audit_log is a plain table the app
// role can insert into, so the digest is always available to the
// verifier (scripts/verify-audit-checkpoint.ts falls back to it).
//
// Shape, in order:
//   1. one read-only withTenant transaction: tenant lookup + the day's
//      audit rows + manifest construction (the hashing is in
//      lib/audit/checkpoint.ts);
//   2. the object store write, outside any DB transaction;
//   3. one anchor transaction containing the existence check and the
//      insert and nothing else — a retry that finds the same digest for
//      the same tenant-day writes no second row.
//
// The manifest is deliberately deterministic (no computedAt): a retry
// after a crash between (2) and (3) overwrites the same key with
// byte-identical content, and the anchor is the only row written.
//
// DEFERRED (E-03's sibling, H-03): the per-row hash chain. This is a
// day-level signed checkpoint, not a chain — writes are never
// serialised. If an enterprise tenant ever requires a chain, that is a
// new task, not an extension of this one.
//
// `deps` exists for tests: inject the in-memory fake store and the
// checkpoint secret instead of the R2-configured store and env.
export type AuditCheckpointDeps = {
  store?: ObjectStore;
  secret?: string;
};

export async function runAuditCheckpointJob(
  tenantId: TenantId,
  onDate?: string,
  deps: AuditCheckpointDeps = {},
): Promise<void> {
  const secret = deps.secret ?? requireCheckpointSecret();
  const store = deps.store ?? getObjectStore();

  const manifest = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
      return null;
    }

    const date = onDate ?? addDays(todayInZone(tenant.timezone), -1);
    const { fromUtc, toUtc } = dayRangeUtc(date, tenant.timezone);
    const rows = await selectAuditRowsForDay(tx, tenantId, fromUtc, toUtc);
    return buildCheckpointManifest(tenantId, date, rows, secret);
  });

  if (!manifest) return;

  await store.putObject(
    checkpointObjectKey(tenantId, manifest.date),
    Buffer.from(JSON.stringify(manifest), "utf8"),
    "application/json",
  );

  await withTenant(tenantId, async (tx) => {
    const existing = await selectCheckpointAnchor(tx, tenantId, manifest.date);
    if (existing?.digest === manifest.digest) return;
    await tx.insert(platformAuditLog).values({
      tenantId,
      action: AUDIT_CHECKPOINT_ACTION,
      detail: {
        date: manifest.date,
        rowCount: manifest.rowCount,
        digest: manifest.digest,
      },
    });
  });

  console.log(
    `[audit.checkpoint] tenant ${tenantId} ${manifest.date}: ` +
      `${manifest.rowCount} row(s), digest ${manifest.digest.slice(0, 12)}…`,
  );
}
