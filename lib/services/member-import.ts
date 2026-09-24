import { and, eq, ilike, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withTenant, type TenantTx } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { isMinor } from "@/lib/time/tz";
import { createMemberInTx } from "@/lib/services/register";
import { findExistingImportMemberId } from "@/lib/services/member-import-match";
import { writeAudit } from "@/lib/audit/write";
import { auditLog } from "@/db/schema/audit";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";
import {
  memberImportErrorsCsv,
  parseMemberImportRows,
  normalizeImportCsv,
  type MemberImportRowError,
  type ParsedMemberImportRow,
} from "@/lib/services/member-import-csv";
import type { ActionCtx } from "@/lib/auth/context";

// PR2-C5 — member import, dry-run half. Parses and validates the CSV
// against the tenant (location names, minor/guardian rule) and writes
// nothing.
// PR2-C6 — the commit half: each valid row goes through createMember
// (the one member-creation path), matched rows are skipped and never
// overwritten, and a retry of the same file is additive and safe.

export type MemberImportPreviewRow = ParsedMemberImportRow & {
  locationId: string | null;
};

export type MemberImportPreview = {
  totalRows: number;
  rows: MemberImportPreviewRow[];
  errors: MemberImportRowError[];
  missingColumns: string[];
  fileError?: string;
};

export function memberImportIdentity(tenantId: string, csvText: string): string {
  return createHash("sha256").update(tenantId).update("\0").update(normalizeImportCsv(csvText)).digest("hex");
}

export { memberImportErrorsCsv };

export async function previewMemberImport(
  ctx: ActionCtx,
  csvText: string,
): Promise<MemberImportPreview> {
  const parsed = parseMemberImportRows(csvText);
  if (parsed.fileError) {
    return { totalRows: parsed.totalRows, rows: [], errors: [], missingColumns: [], fileError: parsed.fileError };
  }
  if (parsed.missingColumns.length > 0) {
    return {
      totalRows: parsed.totalRows,
      rows: [],
      errors: [],
      missingColumns: parsed.missingColumns,
    };
  }

  return withTenant(ctx.tenantId, (tx) => previewMemberImportInTx(tx, ctx, parsed));
}

async function previewMemberImportInTx(
  tx: TenantTx,
  ctx: ActionCtx,
  parsed: ReturnType<typeof parseMemberImportRows>,
): Promise<MemberImportPreview> {
    const access = await resolveLocationAccess(tx, ctx);
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const locationConditions = [eq(locations.tenantId, ctx.tenantId)];
    const predicate = locationPredicate(locations.id, access);
    if (predicate) locationConditions.push(predicate);
    const locationRows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(...locationConditions));
    const byName = new Map(
      locationRows.map((row) => [row.name.trim().toLowerCase(), row.id]),
    );

    const errors = [...parsed.errors];
    const rows: MemberImportPreviewRow[] = [];

    for (const row of parsed.rows) {
      const locationId = byName.get(row.locationName.toLowerCase()) ?? null;
      if (!locationId) {
        errors.push({
          rowNumber: row.rowNumber,
          field: "location",
          reason: `No location named "${row.locationName}".`,
        });
        continue;
      }
      if (isMinor(row.dateOfBirth, tenant?.timezone ?? "Asia/Kolkata")) {
        if (!row.guardianName || !row.guardianPhone) {
          errors.push({
            rowNumber: row.rowNumber,
            field: "guardian_name",
            reason:
              "A minor needs a guardian name and phone (DPDP consent holder).",
          });
          continue;
        }
      }
      rows.push({ ...row, locationId });
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    return {
      totalRows: parsed.totalRows,
      rows,
      errors,
      missingColumns: [],
    };
}

export type MemberImportCommitResult = {
  imported: number;
  skipped: number;
  errors: MemberImportRowError[];
  importedMembers: Array<{ rowNumber: number; memberId: string; memberCode: string }>;
  skippedRows: Array<{ rowNumber: number; memberId: string }>;
};

export async function commitMemberImport(
  ctx: ActionCtx,
  csvText: string,
  attestation?: { attested: true; evidenceNote?: string },
): Promise<MemberImportCommitResult> {
  if (!attestation?.attested || !ctx.userId) {
    throw new Error("An authenticated operator must confirm prior consent before importing.");
  }
  const parsed = parseMemberImportRows(csvText);
  if (parsed.fileError || parsed.missingColumns.length > 0) {
    throw new Error(parsed.fileError ?? `Missing columns: ${parsed.missingColumns.join(", ")}`);
  }
  const importId = memberImportIdentity(ctx.tenantId, csvText);
  return withTenant(ctx.tenantId, async (tx) => {
    // The tenant row is the per-tenant transaction lock. Concurrent uploads
    // wait here, then observe the previous import's committed audit/result.
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.id, ctx.tenantId)).for("update");
    if (!tenant) throw new Error("Tenant not found.");
    const [previous] = await tx.select({ after: auditLog.after }).from(auditLog)
      .where(and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.action, "member.import"),
        sql`${auditLog.after}->>'importId' = ${importId}`)).limit(1);
    if (previous) {
      const last = previous.after as { importedMembers?: MemberImportCommitResult["importedMembers"]; skippedRows?: MemberImportCommitResult["skippedRows"]; rowErrors?: MemberImportRowError[] };
      const skippedRows = [
        ...(last.importedMembers ?? []).map((member) => ({ rowNumber: member.rowNumber, memberId: member.memberId })),
        ...(last.skippedRows ?? []),
      ];
      return { imported: 0, skipped: skippedRows.length, errors: last.rowErrors ?? [], importedMembers: [], skippedRows };
    }
    const preview = await previewMemberImportInTx(tx, ctx, parsed);
    const attestedAt = new Date().toISOString();
    const errors = [...preview.errors];
    const importedMembers: MemberImportCommitResult["importedMembers"] = [];
    const skippedRows: MemberImportCommitResult["skippedRows"] = [];
    const [{ n }] = await tx.select({
      n: sql<number>`coalesce(max(substring(${members.memberCode} from '[0-9]+$')::int), 0)`,
    }).from(members).where(and(eq(members.tenantId, ctx.tenantId), ilike(members.memberCode, "MEM-%")));
    let nextCode = n;
    const reservedCodes = new Set(preview.rows.flatMap((row) => row.memberCode ? [row.memberCode] : []));

    for (const row of preview.rows) {
      const existingId = await findExistingImportMemberId(tx, ctx, row);
      if (existingId) {
        skippedRows.push({ rowNumber: row.rowNumber, memberId: existingId });
        continue;
      }

      let memberCode = row.memberCode;
      if (!memberCode) {
        do { memberCode = `MEM-${String(++nextCode).padStart(4, "0")}`; }
        while (reservedCodes.has(memberCode));
      }
      const created = await createMemberInTx(tx, ctx, {
        fullName: row.fullName,
        dateOfBirth: row.dateOfBirth,
        phone: row.phone ?? undefined,
        locationId: row.locationId!,
        memberCode,
        guardian: row.guardianName && row.guardianPhone
          ? { fullName: row.guardianName, phone: row.guardianPhone, relationship: "guardian" }
          : undefined,
        consents: [{
          purpose: "processing",
          policyVersion: CURRENT_POLICY_VERSION,
          evidence: {
            channel: "import_operator_attestation",
            importId,
            attestedAt,
            operatorUserId: ctx.userId,
            evidenceNote: attestation.evidenceNote,
          },
        }],
      });
      if (!created.ok) throw new Error(`Row ${row.rowNumber}: ${created.error}`);
      importedMembers.push({ rowNumber: row.rowNumber, memberId: created.memberId, memberCode });
    }

    // Keep the final outcome and all row writes in the SAME transaction.
    // An error here rolls back every member, guardian and consent row.
    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "member.import",
      entityType: "tenant",
      entityId: ctx.tenantId,
      after: {
        importId,
        evidenceChannel: "import_operator_attestation",
        attestedAt,
        evidenceNote: attestation.evidenceNote ?? null,
        imported: importedMembers.length,
        skipped: skippedRows.length,
        errors: errors.length,
        importedMembers,
        skippedRows,
        rowErrors: errors,
      },
    });
    return {
      imported: importedMembers.length,
      skipped: skippedRows.length,
      errors,
      importedMembers,
      skippedRows,
    };
  });
}
