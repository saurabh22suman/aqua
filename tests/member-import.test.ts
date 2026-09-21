import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import {
  memberImportErrorsCsv,
  memberImportTemplateCsv,
  parseCsv,
  parseImportDate,
  parseMemberImportRows,
} from "@/lib/services/member-import-csv";
import { previewMemberImport, commitMemberImport } from "@/lib/services/member-import";

// PR2-C5 — CSV import parser, validator and dry-run. Pure parsing
// rules first (quotes, commas, newlines, ambiguous dates, real
// calendar dates, phones), then the tenant-aware preview: location
// names resolve, unknown locations and minors without a guardian are
// row errors with row numbers, and a dry run writes nothing.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const tenantBId = asTenantId(uuidv7());
const locationId = uuidv7();
const locationBId = uuidv7();

async function memberCount(tenant: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from members where tenant_id = $1",
    [tenant],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Import Test', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Import Test B', 'active', 'Asia/Kolkata')`,
    [tenantId, `import-${RUN}`, tenantBId, `import-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Worli', true),
       ($3, $4, 'Worli', true)`,
    [locationId, tenantId, locationBId, tenantBId],
  );
});

afterAll(async () => {
  for (const tenant of [tenantId, tenantBId]) {
    await admin.query("delete from consents where tenant_id = $1", [tenant]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenant]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await admin.query("delete from tenants where id = $1", [tenant]);
  }
  await admin.end();
});

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes and newlines in fields", () => {
    const { rows } = parseCsv(
      'full_name,date_of_birth,location\n"Rao, Asha","2015-04-12","Worli"\n"Quote ""Q""","2014-01-01","Worli"\n"Two\nLines","2013-01-01","Worli"\n',
    );
    expect(rows).toHaveLength(4);
    expect(rows[1]!.values[0]).toBe("Rao, Asha");
    expect(rows[2]!.values[0]).toBe('Quote "Q"');
    expect(rows[3]!.values[0]).toBe("Two\nLines");
    expect(rows[3]!.rowNumber).toBe(4);
  });
});

describe("parseImportDate", () => {
  it("accepts a real ISO date", () => {
    expect(parseImportDate("2015-04-12")).toEqual({
      ok: true,
      value: "2015-04-12",
    });
  });

  it("rejects a date that does not exist", () => {
    const result = parseImportDate("2026-02-30");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not exist/i);
  });

  it("rejects an ambiguous DD/MM/YYYY date and accepts an unambiguous one", () => {
    const ambiguous = parseImportDate("03/04/2026");
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.reason).toMatch(/ambiguous/i);

    expect(parseImportDate("25/12/2026")).toEqual({
      ok: true,
      value: "2026-12-25",
    });
  });
});

describe("parseMemberImportRows", () => {
  it("reports missing required columns once, not per row", () => {
    const result = parseMemberImportRows("full_name,location\nAsha,Worli\n");
    expect(result.missingColumns).toEqual(["date_of_birth"]);
    expect(result.errors).toEqual([]);
  });

  it("reports every rejected row with its row number, field and reason", () => {
    const csv = [
      "full_name,date_of_birth,location,phone",
      "Asha Rao,2015-04-12,Worli,+919876543210",
      ",2015-04-12,Worli,",
      "Bela Shah,2026-02-30,Worli,",
      "Cara Nair,2015-04-12,,",
      "Dev Patel,2015-04-12,Worli,12345",
    ].join("\n");
    const result = parseMemberImportRows(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.fullName).toBe("Asha Rao");
    expect(result.errors.map((e) => [e.rowNumber, e.field])).toEqual([
      [3, "full_name"],
      [4, "date_of_birth"],
      [5, "location"],
      [6, "phone"],
    ]);
  });

  it("ignores extra columns and blank lines", () => {
    const csv =
      "full_name,date_of_birth,location,favourite_colour\nAsha Rao,2015-04-12,Worli,blue\n\n";
    const result = parseMemberImportRows(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("memberImportErrorsCsv", () => {
  it("quotes reasons that contain commas or quotes", () => {
    const csv = memberImportErrorsCsv([
      { rowNumber: 4, field: "date_of_birth", reason: 'Bad, "quoted" reason' },
    ]);
    expect(csv.split("\n")[0]).toBe("row,field,reason");
    expect(csv).toContain('4,date_of_birth,"Bad, ""quoted"" reason"');
  });
});

describe("memberImportTemplateCsv", () => {
  it("ships the canonical headers and one example row", () => {
    const csv = memberImportTemplateCsv();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "full_name,date_of_birth,location,phone,guardian_name,guardian_phone,member_code",
    );
    expect(lines).toHaveLength(2);
  });
});

describe("previewMemberImport (dry run)", () => {
  it("resolves location names, flags unknown locations and writes nothing", async () => {
    const before = (
      await admin.query<{ n: string }>(
        "select count(*)::text as n from members where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!.n;

    const csv = [
      "full_name,date_of_birth,location,phone,guardian_name,guardian_phone",
      "Asha Adult,1990-04-12,Worli,+919876543210,,",
      "Bela Child,2015-04-12,Worli,,Ravi Rao,+919876543211",
      "Cara Missing,2015-04-12,Bandra,,",
    ].join("\n");

    const preview = await previewMemberImport({ tenantId }, csv);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]!.locationId).toBe(locationId);
    expect(preview.errors).toEqual([
      {
        rowNumber: 4,
        field: "location",
        reason: 'No location named "Bandra".',
      },
    ]);

    const after = (
      await admin.query<{ n: string }>(
        "select count(*)::text as n from members where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!.n;
    expect(after).toBe(before);
  });

  it("rejects a minor without a guardian at preview time", async () => {
    const csv = [
      "full_name,date_of_birth,location,guardian_name,guardian_phone",
      "Bela Child,2015-04-12,Worli,,",
    ].join("\n");
    const preview = await previewMemberImport({ tenantId }, csv);
    expect(preview.rows).toHaveLength(0);
    expect(preview.errors[0]).toMatchObject({
      rowNumber: 2,
      field: "guardian_name",
    });
    expect(preview.errors[0]!.reason).toMatch(/guardian/i);
  });
});

describe("commitMemberImport", () => {
  const CSV = [
    "full_name,date_of_birth,location,phone,guardian_name,guardian_phone,member_code",
    "Import Adult,1990-05-05,Worli,+919811100001,,,IMP-ADULT-1",
    "Import Child,2015-05-05,Worli,,Ravi Rao,+919811100002,",
  ].join("\n");

  it("imports valid rows through createMember with import consent evidence", async () => {
    const before = await memberCount(tenantId);
    const result = await commitMemberImport({ tenantId }, CSV);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(await memberCount(tenantId)).toBe(before + 2);

    const codes = await admin.query<{ member_code: string }>(
      "select member_code from members where tenant_id = $1 and member_code in ('IMP-ADULT-1') or (tenant_id = $1 and member_code like 'MEM-%')",
      [tenantId],
    );
    expect(codes.rows.map((r) => r.member_code)).toContain("IMP-ADULT-1");
    expect(codes.rows.some((r) => r.member_code.startsWith("MEM-"))).toBe(true);

    const consents = await admin.query<{ purpose: string; channel: string }>(
      `select c.purpose, c.evidence->>'channel' as channel
         from consents c
         join members m on m.person_id = c.person_id and m.tenant_id = c.tenant_id
        where m.tenant_id = $1 and m.member_code = 'IMP-ADULT-1'`,
      [tenantId],
    );
    expect(consents.rows).toEqual([{ purpose: "processing", channel: "import" }]);

    const child = await admin.query<{ n: string }>(
      `select count(*)::text as n from guardianships g
         join members m on m.person_id = g.minor_id and m.tenant_id = g.tenant_id
        where m.tenant_id = $1 and m.member_code like 'MEM-%'`,
      [tenantId],
    );
    expect(Number(child.rows[0]!.n)).toBe(1);
  });

  it("is idempotent: a second run skips every matched row and creates nothing", async () => {
    const before = await memberCount(tenantId);
    const result = await commitMemberImport({ tenantId }, CSV);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(await memberCount(tenantId)).toBe(before);
  });

  it("never overwrites an existing member matched by code", async () => {
    const csv = [
      "full_name,date_of_birth,location,member_code",
      "Different Name,1980-01-01,Worli,IMP-ADULT-1",
    ].join("\n");
    const result = await commitMemberImport({ tenantId }, csv);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);

    const person = await admin.query<{ full_name: string }>(
      `select p.full_name from persons p
         join members m on m.person_id = p.id
        where m.tenant_id = $1 and m.member_code = 'IMP-ADULT-1'`,
      [tenantId],
    );
    expect(person.rows[0]!.full_name).toBe("Import Adult");
  });

  it("returns preview errors and imports nothing when a row is invalid", async () => {
    const csv = [
      "full_name,date_of_birth,location,guardian_name,guardian_phone",
      "No Guardian Child,2015-01-01,Worli,,",
    ].join("\n");
    const before = await memberCount(tenantId);
    const result = await commitMemberImport({ tenantId }, csv);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toMatchObject({ rowNumber: 2, field: "guardian_name" });
    expect(await memberCount(tenantId)).toBe(before);
  });

  it("keeps tenants isolated", async () => {
    const beforeA = await memberCount(tenantId);
    const result = await commitMemberImport({ tenantId: tenantBId }, CSV);
    expect(result.imported).toBe(2);
    expect(await memberCount(tenantBId)).toBe(2);
    expect(await memberCount(tenantId)).toBe(beforeA);
  });
});
