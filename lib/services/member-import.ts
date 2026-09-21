import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { members, persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { isMinor } from "@/lib/time/tz";
import { createMember } from "@/lib/services/register";
import { nextMemberCode } from "@/lib/services/people";
import { writeAudit } from "@/lib/audit/write";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";
import {
  memberImportErrorsCsv,
  parseMemberImportRows,
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
};

export { memberImportErrorsCsv };

export async function previewMemberImport(
  ctx: ActionCtx,
  csvText: string,
): Promise<MemberImportPreview> {
  const parsed = parseMemberImportRows(csvText);
  if (parsed.missingColumns.length > 0) {
    return {
      totalRows: parsed.totalRows,
      rows: [],
      errors: [],
      missingColumns: parsed.missingColumns,
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
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
  });
}

export type MemberImportCommitResult = {
  imported: number;
  skipped: number;
  errors: MemberImportRowError[];
  importedMembers: Array<{ rowNumber: number; memberId: string; memberCode: string }>;
  skippedRows: Array<{ rowNumber: number; memberId: string }>;
};

// A row matches an existing member by member code first (the
// operator's own identifier), then by phone + name + date of birth.
// Matching rows are skipped, never overwritten.
async function findExistingMemberId(
  ctx: ActionCtx,
  row: MemberImportPreviewRow,
): Promise<string | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    if (row.memberCode) {
      const byCode = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.tenantId, ctx.tenantId),
            eq(members.memberCode, row.memberCode),
            isNull(members.deletedAt),
          ),
        )
        .limit(1);
      if (byCode[0]) return byCode[0].id;
    }
    if (row.phone) {
      const byPerson = await tx
        .select({ id: members.id })
        .from(members)
        .innerJoin(
          persons,
          and(
            eq(persons.id, members.personId),
            eq(persons.tenantId, members.tenantId),
          ),
        )
        .where(
          and(
            eq(members.tenantId, ctx.tenantId),
            isNull(members.deletedAt),
            eq(persons.phone, row.phone),
            eq(persons.fullName, row.fullName),
            eq(persons.dateOfBirth, row.dateOfBirth),
          ),
        )
        .limit(1);
      if (byPerson[0]) return byPerson[0].id;
    } else {
      // Guardian-only rows (minors) carry no phone of their own; name +
      // date of birth is the only stable identity the file offers, and
      // it keeps a re-import idempotent.
      const byNameDob = await tx
        .select({ id: members.id })
        .from(members)
        .innerJoin(
          persons,
          and(
            eq(persons.id, members.personId),
            eq(persons.tenantId, members.tenantId),
          ),
        )
        .where(
          and(
            eq(members.tenantId, ctx.tenantId),
            isNull(members.deletedAt),
            eq(persons.fullName, row.fullName),
            eq(persons.dateOfBirth, row.dateOfBirth),
          ),
        )
        .limit(1);
      if (byNameDob[0]) return byNameDob[0].id;
    }
    return null;
  });
}

export async function commitMemberImport(
  ctx: ActionCtx,
  csvText: string,
): Promise<MemberImportCommitResult> {
  const preview = await previewMemberImport(ctx, csvText);
  const errors = [...preview.errors];
  const importedMembers: MemberImportCommitResult["importedMembers"] = [];
  const skippedRows: MemberImportCommitResult["skippedRows"] = [];

  for (const row of preview.rows) {
    const existingId = await findExistingMemberId(ctx, row);
    if (existingId) {
      skippedRows.push({ rowNumber: row.rowNumber, memberId: existingId });
      continue;
    }

    const memberCode = row.memberCode ?? (await nextMemberCode(ctx));
    const created = await createMember(ctx, {
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth,
      phone: row.phone ?? undefined,
      locationId: row.locationId!,
      memberCode,
      guardian:
        row.guardianName && row.guardianPhone
          ? {
              fullName: row.guardianName,
              phone: row.guardianPhone,
              relationship: "guardian",
            }
          : undefined,
      consents: [
        {
          purpose: "processing",
          policyVersion: CURRENT_POLICY_VERSION,
          evidence: { channel: "import" },
        },
      ],
    });
    if (!created.ok) {
      errors.push({
        rowNumber: row.rowNumber,
        field: "row",
        reason: created.error,
      });
      continue;
    }
    importedMembers.push({
      rowNumber: row.rowNumber,
      memberId: created.memberId,
      memberCode,
    });
  }

  if (preview.rows.length > 0) {
    await withTenant(ctx.tenantId, async (tx) => {
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId ?? null,
        requestId: ctx.requestId ?? null,
        action: "member.import",
        entityType: "tenant",
        entityId: ctx.tenantId,
        after: {
          imported: importedMembers.length,
          skipped: skippedRows.length,
          errors: errors.length,
        },
      });
    });
  }

  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    imported: importedMembers.length,
    skipped: skippedRows.length,
    errors,
    importedMembers,
    skippedRows,
  };
}
