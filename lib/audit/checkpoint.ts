import { createHmac } from "node:crypto";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/db/schema/audit";
import type { TenantTx } from "@/db/tenant";
import { canonicalJsonStringify, fixedTimestamp } from "@/lib/canonical-json";
import { env } from "@/lib/env";
import type { TenantId } from "@/lib/ids";

// E-03 — the audit checkpoint digest (architecture.md §8.10).
//
// A tenant-day's audit_log rows are canonicalised, hashed per row with
// HMAC-SHA256, and folded into one aggregate HMAC. The manifest — the
// aggregate digest plus the per-row hashes that localise a divergence —
// is written to the object store, and the aggregate digest is anchored
// in platform_audit_log so a verification never depends on R2 being up
// (scripts/verify-audit-checkpoint.ts falls back to the anchor).
//
// Canonicalisation rules, deliberately conservative:
//   * every column is included — "exclude nothing" leaves no field a
//     tamper could quietly change outside the digest;
//   * the value transform itself (sorted keys, fixed timestamps,
//     BigInt/Date normalisation) lives in lib/canonical-json.ts so the
//     E-06 export can produce byte-stable NDJSON through the same code
//     path;
//   * arrays keep their order (changed_fields is positional);
//   * rows are ordered by id (bigserial insertion order) before
//     hashing, and the row order is part of the digest.
//
// This is deliberately NOT a per-row hash chain: there is no row N-1
// dependency, writes are never serialised, and the evidence is the
// signed day-level checkpoint. An enterprise demand for a hash chain
// is a separate task, not an extension of this one.

export type AuditCheckpointRow = {
  id: string;
  tenantId: string;
  actorType: string;
  actorId: string | null;
  impersonatorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  changedFields: string[] | null;
  ip: string | null;
  source: string;
  requestId: string | null;
  createdAt: Date | string;
};

export type CheckpointRowHash = { id: string; hash: string };

export type AuditCheckpointManifest = {
  version: 1;
  tenantId: string;
  date: string;
  rowCount: number;
  digest: string;
  rows: CheckpointRowHash[];
};

export const AUDIT_CHECKPOINT_VERSION = 1;

export function checkpointObjectKey(tenantId: string, date: string): string {
  return `audit-checkpoints/${tenantId}/${date}.json`;
}

function rowPayload(row: AuditCheckpointRow): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    impersonatorId: row.impersonatorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    changedFields: row.changedFields,
    ip: row.ip,
    source: row.source,
    requestId: row.requestId,
    createdAt: fixedTimestamp(row.createdAt),
  };
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function digestAuditRows(
  rows: AuditCheckpointRow[],
  secret: string,
): { digest: string; rowCount: number; rows: CheckpointRowHash[] } {
  const hashes: CheckpointRowHash[] = rows.map((row) => ({
    id: row.id,
    hash: hmacHex(secret, canonicalJsonStringify(rowPayload(row))),
  }));
  const digest = hmacHex(
    secret,
    hashes.map((entry) => `${entry.id}:${entry.hash}`).join("\n"),
  );
  return { digest, rowCount: rows.length, rows: hashes };
}

export function buildCheckpointManifest(
  tenantId: string,
  date: string,
  rows: AuditCheckpointRow[],
  secret: string,
): AuditCheckpointManifest {
  const { digest, rowCount, rows: hashes } = digestAuditRows(rows, secret);
  return {
    version: AUDIT_CHECKPOINT_VERSION,
    tenantId,
    date,
    rowCount,
    digest,
    rows: hashes,
  };
}

export type CheckpointVerification =
  | { ok: true; digest: string; rowCount: number }
  | { ok: false; reason: string; firstDivergentRowId?: string };

// Recomputes the manifest from the rows on disk and compares. When the
// expected per-row hashes are available, the first divergence is
// localised to a row id; when only the anchored digest is available
// (object store disabled), a mismatch is still detected, just not
// localised.
export function verifyCheckpoint(
  expected: {
    digest: string;
    rowCount: number;
    rows?: CheckpointRowHash[];
  },
  rows: AuditCheckpointRow[],
  secret: string,
): CheckpointVerification {
  const actual = digestAuditRows(rows, secret);

  if (expected.rows) {
    const limit = Math.max(expected.rows.length, actual.rows.length);
    for (let i = 0; i < limit; i++) {
      const wanted = expected.rows[i];
      const found = actual.rows[i];
      if (wanted && found && wanted.id === found.id && wanted.hash === found.hash) {
        continue;
      }
      const id = (wanted ?? found)?.id;
      const reason = !found
        ? `audit row id=${wanted!.id} is missing (manifest has ${expected.rowCount} rows, database has ${actual.rowCount})`
        : !wanted
          ? `audit row id=${found.id} is not in the manifest (manifest has ${expected.rowCount} rows, database has ${actual.rowCount})`
          : `audit row id=${wanted.id} differs (manifest hash ${wanted.hash}, recomputed hash ${found.hash})`;
      return { ok: false, reason, firstDivergentRowId: id };
    }
  }

  if (expected.rowCount !== actual.rowCount) {
    return {
      ok: false,
      reason: `row count differs (manifest ${expected.rowCount}, database ${actual.rowCount})`,
    };
  }

  if (expected.digest !== actual.digest) {
    return {
      ok: false,
      reason: expected.rows
        ? "stored digest is not the HMAC of its own row hashes"
        : "digest mismatch (no per-row manifest available to localise the first divergent row)",
    };
  }

  return { ok: true, digest: actual.digest, rowCount: actual.rowCount };
}

const manifestSchema = z.object({
  version: z.literal(AUDIT_CHECKPOINT_VERSION),
  tenantId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rowCount: z.number().int().nonnegative(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(
    z.object({
      id: z.string().min(1),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export function parseCheckpointManifest(bytes: Uint8Array): AuditCheckpointManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("checkpoint manifest is not valid JSON");
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `checkpoint manifest failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

// The one query behind both the job and the verifier, so the set of
// hashed columns can never drift between them. Ordered by id (bigserial
// insertion order) — the ordering is part of the digest.
export async function selectAuditRowsForDay(
  tx: TenantTx,
  tenantId: TenantId,
  fromUtc: Date,
  toUtc: Date,
): Promise<AuditCheckpointRow[]> {
  const rows = await tx
    .select({
      id: auditLog.id,
      tenantId: auditLog.tenantId,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      impersonatorId: auditLog.impersonatorId,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      changedFields: auditLog.changedFields,
      ip: auditLog.ip,
      source: auditLog.source,
      requestId: auditLog.requestId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, tenantId),
        gte(auditLog.createdAt, fromUtc),
        lt(auditLog.createdAt, toUtc),
      ),
    )
    .orderBy(asc(auditLog.id));

  return rows.map((row) => ({
    id: String(row.id),
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    impersonatorId: row.impersonatorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    changedFields: row.changedFields,
    ip: row.ip,
    source: row.source,
    requestId: row.requestId,
    createdAt: row.createdAt,
  }));
}

// The checkpoint secret is optional at boot (the app does not need it)
// but mandatory at the crypto boundary. Callers that compute or verify
// a checkpoint call this instead of touching env directly, so a missing
// key is one clear error instead of an unsigned digest.
export function requireCheckpointSecret(): string {
  const secret = env.AUDIT_CHECKPOINT_SECRET;
  if (!secret) {
    throw new Error(
      "AUDIT_CHECKPOINT_SECRET is not set — refusing to compute or verify an unsigned audit checkpoint. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return secret;
}

