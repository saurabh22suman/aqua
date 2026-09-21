import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { isMinor } from "@/lib/time/tz";
import {
  memberImportErrorsCsv,
  parseMemberImportRows,
  type MemberImportRowError,
  type ParsedMemberImportRow,
} from "@/lib/services/member-import-csv";
import type { ActionCtx } from "@/lib/auth/context";

// PR2-C5 — member import, dry-run half. Parses and validates the CSV
// against the tenant (location names, minor/guardian rule) and writes
// nothing. PR2-C6 adds the commit path on top of the same row shape.

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
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const locationRows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.tenantId, ctx.tenantId));
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
