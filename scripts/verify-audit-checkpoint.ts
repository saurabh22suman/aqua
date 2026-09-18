import { eq } from "drizzle-orm";
import { pool } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import {
  checkpointObjectKey,
  parseCheckpointManifest,
  requireCheckpointSecret,
  selectAuditRowsForDay,
  verifyCheckpoint,
  type CheckpointRowHash,
} from "@/lib/audit/checkpoint";
import { selectCheckpointAnchor } from "@/lib/audit/checkpoint-anchor";
import { getObjectStore, isObjectStoreEnabled } from "@/lib/storage/object-store";
import { dayRangeUtc } from "@/lib/time/tz";
import { asTenantId } from "@/lib/ids";

// E-03 verifier — recompute a tenant-day's audit digest and compare it
// against the checkpoint.
//
// Source of truth, in order:
//   1. the manifest object (audit-checkpoints/<tenantId>/<date>.json)
//      when the object store is configured — it carries the per-row
//      hashes, so a divergence is localised to the first tampered row;
//   2. otherwise the platform_audit_log anchor's digest. The anchor is
//      always available (no RLS, insert-granted to the app role), so a
//      verification never depends on R2 being up — but a plain digest
//      mismatch cannot name the row.
//
// Exit codes:
//   0  verified
//   1  divergence (prints the first divergent row id when known)
//   2  usage error
//   3  checkpoint missing / unreadable
//
// Usage: tsx scripts/verify-audit-checkpoint.ts <tenantId> <YYYY-MM-DD>

const USAGE =
  "Usage: tsx scripts/verify-audit-checkpoint.ts <tenantId> <YYYY-MM-DD>";

async function main(): Promise<void> {
  const [tenantId, date, ...rest] = process.argv.slice(2);
  if (
    !tenantId ||
    !date ||
    rest.length > 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    console.error(USAGE);
    process.exit(2);
  }

  const secret = requireCheckpointSecret();
  const store = getObjectStore();
  const tid = asTenantId(tenantId);

  const rows = await withTenant(tid, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tid));
    if (!tenant) {
      throw new Error(`no tenant ${tenantId}`);
    }
    const { fromUtc, toUtc } = dayRangeUtc(date, tenant.timezone);
    return selectAuditRowsForDay(tx, tid, fromUtc, toUtc);
  });

  let expected: { digest: string; rowCount: number; rows?: CheckpointRowHash[] };
  let source: string;

  if (isObjectStoreEnabled()) {
    const key = checkpointObjectKey(tenantId, date);
    const bytes = await store.getObject(key);
    if (bytes === null) {
      console.error(
        `verify-audit-checkpoint: no checkpoint manifest at ${key} (object store is enabled) — cannot verify.`,
      );
      process.exit(3);
    }
    const manifest = parseCheckpointManifest(bytes);
    if (manifest.tenantId !== tenantId || manifest.date !== date) {
      console.error(
        `verify-audit-checkpoint: manifest at ${key} is for ${manifest.tenantId}/${manifest.date}, not ${tenantId}/${date}.`,
      );
      process.exit(3);
    }
    expected = manifest;
    source = "object-store manifest";
  } else {
    const anchor = await withTenant(tid, (tx) =>
      selectCheckpointAnchor(tx, tid, date),
    );
    if (!anchor) {
      console.error(
        `verify-audit-checkpoint: no object-store manifest (store disabled) and no platform_audit_log anchor for ${tenantId}/${date} — cannot verify.`,
      );
      process.exit(3);
    }
    expected = anchor;
    source = "platform_audit_log anchor (object store disabled)";
  }

  const result = verifyCheckpoint(expected, rows, secret);
  if (!result.ok) {
    console.error(
      `verify-audit-checkpoint: DIVERGENCE — tenant ${tenantId} ${date} (${source}): ${result.reason}`,
    );
    if (result.firstDivergentRowId !== undefined) {
      console.error(
        `  first divergent audit_log row id: ${result.firstDivergentRowId}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `verify-audit-checkpoint: OK — tenant ${tenantId} ${date}: ` +
      `${result.rowCount} row(s), digest ${result.digest} (${source}).`,
  );
}

main()
  .catch((err) => {
    console.error(
      `verify-audit-checkpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(3);
  })
  .finally(async () => {
    await pool.end();
  });
