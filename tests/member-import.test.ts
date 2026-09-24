import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "@/tests/helpers/audit-log-cleanup";
import {
  MAX_MEMBER_IMPORT_ROWS,
  memberImportErrorsCsv,
  memberImportTemplateCsv,
  parseCsv,
  parseImportDate,
  parseMemberImportRows,
} from "@/lib/services/member-import-csv";
import { previewMemberImport, commitMemberImport, memberImportIdentity } from "@/lib/services/member-import";
import { commitMemberImportAction } from "@/lib/actions/member-import";

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
const actorId = asUserId(uuidv7());
const attest = { attested: true as const, evidenceNote: "Paper register 2025" };

async function memberCount(tenant: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from members where tenant_id = $1",
    [tenant],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  await admin.query("insert into users (id, phone) values ($1, $2)", [actorId, `+9198${RUN.slice(-8).padStart(8, "0")}`.replace(/[^+\d]/g, "1")]);
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
    await deleteAuditRowsForTenant(admin, tenant);
    await admin.query("delete from consents where tenant_id = $1", [tenant]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenant]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await admin.query("delete from tenants where id = $1", [tenant]);
  }
  await admin.query("delete from users where id = $1", [actorId]);
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

  it("rejects broken quoting instead of silently merging records", () => {
    expect(parseMemberImportRows('full_name,date_of_birth,location\n"Unclosed,1990-01-01,Worli').fileError).toMatch(/unterminated/i);
    expect(parseMemberImportRows('full_name,date_of_birth,location\nAb"c,1990-01-01,Worli').fileError).toMatch(/quote placement/i);
    expect(parseMemberImportRows('full_name,date_of_birth,location\n"Ab"c,1990-01-01,Worli').fileError).toMatch(/quote placement/i);
    expect(parseMemberImportRows('full_name,date_of_birth,location\nBad\uFFFD,1990-01-01,Worli').fileError).toMatch(/UTF-8/i);
  });

  it("accepts 500 rows, rejects 501 and keeps multiline quoted fields as one row", () => {
    const header = "full_name,date_of_birth,location";
    const rows = Array.from({ length: MAX_MEMBER_IMPORT_ROWS }, (_, i) => `Adult ${i},1990-01-01,Worli`);
    expect(parseMemberImportRows([header, ...rows].join("\n")).rows).toHaveLength(500);
    expect(parseMemberImportRows([header, ...rows, "Excess,1990-01-01,Worli"].join("\n")).fileError).toMatch(/500/);
    expect(parseMemberImportRows(`${header}\n"Ada,\n Lee",1990-01-01,Worli`).rows[0]?.fullName).toBe("Ada,\n Lee");
  });

  it("neutralizes formula prefixes in every downloadable error CSV field", () => {
    const csv = memberImportErrorsCsv([{ rowNumber: 2, field: "=cell", reason: "+payload" }]);
    expect(csv).toContain("2,'=cell,'+payload");
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
    const result = await commitMemberImport({ tenantId, userId: actorId }, CSV, attest);
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

    const consents = await admin.query<{ purpose: string; channel: string; import_id: string; actor: string; witnessed: string; granted_at: Date; attested_at: string; note: string }>(
      `select c.purpose, c.evidence->>'channel' as channel,
              c.evidence->>'importId' as import_id, c.evidence->>'operatorUserId' as actor,
              c.witnessed_by_user_id as witnessed, c.granted_at, c.evidence->>'attestedAt' as attested_at,
              c.evidence->>'evidenceNote' as note
         from consents c
         join members m on m.person_id = c.person_id and m.tenant_id = c.tenant_id
        where m.tenant_id = $1 and m.member_code = 'IMP-ADULT-1'`,
      [tenantId],
    );
    expect(consents.rows).toMatchObject([{ purpose: "processing", channel: "import_operator_attestation", import_id: memberImportIdentity(tenantId, CSV), actor: actorId, witnessed: actorId, note: attest.evidenceNote }]);
    expect(consents.rows[0]?.granted_at).toBeInstanceOf(Date);
    expect(new Date(consents.rows[0]!.attested_at).getTime()).toBeGreaterThan(0);

    const audit = await admin.query<{ actor_id: string; after: { importId: string; evidenceChannel: string; importedMembers: unknown[] } }>(
      "select actor_id, after from audit_log where tenant_id = $1 and action = 'member.import' order by created_at desc limit 1", [tenantId],
    );
    expect(audit.rows[0]).toMatchObject({ actor_id: actorId, after: { importId: memberImportIdentity(tenantId, CSV), evidenceChannel: "import_operator_attestation" } });
    expect(audit.rows[0]?.after.importedMembers).toHaveLength(2);

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
    const consentBefore = await admin.query<{ n: string }>("select count(*)::text as n from consents where tenant_id = $1", [tenantId]);
    const result = await commitMemberImport({ tenantId, userId: actorId }, CSV, attest);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(await memberCount(tenantId)).toBe(before);
    const consentAfter = await admin.query<{ n: string }>("select count(*)::text as n from consents where tenant_id = $1", [tenantId]);
    expect(consentAfter.rows[0]?.n).toBe(consentBefore.rows[0]?.n);
  });

  it("rejects missing attestation and unauthenticated callers before any write", async () => {
    const before = await memberCount(tenantId);
    await expect(commitMemberImport({ tenantId, userId: actorId }, CSV)).rejects.toThrow(/confirm prior consent/i);
    await expect(commitMemberImport({ tenantId }, CSV, attest)).rejects.toThrow(/authenticated operator/i);
    expect(await commitMemberImportAction({ csv: CSV })).toMatchObject({ ok: false });
    expect(await memberCount(tenantId)).toBe(before);
  });

  it("rejects a 501-row commit without persisting even its first valid row", async () => {
    const csv = ["full_name,date_of_birth,location,member_code",
      ...Array.from({ length: 501 }, (_, i) => `Over ${i},1990-01-01,Worli,OVER-${i}`)].join("\n");
    const before = await memberCount(tenantId);
    await expect(commitMemberImport({ tenantId, userId: actorId }, csv, attest)).rejects.toThrow(/500/);
    expect(await memberCount(tenantId)).toBe(before);
  });

  it("serializes identical and distinct concurrent imports per tenant", async () => {
    const different = "full_name,date_of_birth,location,member_code\nConcurrent A,1990-01-01,Worli,PAR-A\nConcurrent B,1990-01-01,Worli,PAR-B";
    const [first, replay] = await Promise.all(Array.from({ length: 2 }, () => commitMemberImport({ tenantId, userId: actorId }, different, attest)));
    expect([first.imported, replay.imported].sort()).toEqual([0, 2]);
    const next = "full_name,date_of_birth,location,member_code\nConcurrent C,1990-01-01,Worli,PAR-C";
    const [one, two] = await Promise.all([commitMemberImport({ tenantId, userId: actorId }, next, attest), commitMemberImport({ tenantId, userId: actorId }, different, attest)]);
    expect(one.imported).toBe(1);
    expect(two.imported).toBe(0);
    expect((await admin.query("select id from members where tenant_id = $1 and member_code like 'PAR-%'", [tenantId])).rowCount).toBe(3);
    const fresh = ["PAR-D", "PAR-E"].map((code) => `full_name,date_of_birth,location,member_code\n${code},1990-01-01,Worli,${code}`);
    const distinct = await Promise.all(fresh.map((csv) => commitMemberImport({ tenantId, userId: actorId }, csv, attest)));
    expect(distinct.map((r) => r.imported)).toEqual([1, 1]);
  });

  it("audits accepted rows and invalid-row results in the same committed file", async () => {
    const csv = "full_name,date_of_birth,location,member_code\nGood,1990-01-01,Worli,PARTIAL-OK\nBad,2015-01-01,Worli,PARTIAL-NO";
    const result = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
    expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [{ rowNumber: 3, field: "guardian_name" }] });
    const audit = await admin.query<{ after: { imported: number; errors: number; rowErrors: Array<{ rowNumber: number }> } }>(
      "select after from audit_log where tenant_id = $1 and after->>'importId' = $2", [tenantId, memberImportIdentity(tenantId, csv)],
    );
    expect(audit.rows).toMatchObject([{ after: { imported: 1, errors: 1, rowErrors: [{ rowNumber: 3 }] } }]);
    expect((await admin.query("select id from members where tenant_id = $1 and member_code = 'PARTIAL-NO'", [tenantId])).rowCount).toBe(0);
  });

  it("normalizes line endings for a stable tenant-bound identity", () => {
    expect(memberImportIdentity(tenantId, CSV.replaceAll("\n", "\r\n"))).toBe(memberImportIdentity(tenantId, `\uFEFF${CSV}`));
    expect(memberImportIdentity(tenantId, CSV)).not.toBe(memberImportIdentity(tenantBId, CSV));
  });

  it("commits all 500 valid rows atomically at the documented boundary", async () => {
    const csv = ["full_name,date_of_birth,location,member_code",
      ...Array.from({ length: 500 }, (_, i) => `Bulk ${i},1990-01-01,Worli,BULK-${i}`)].join("\n");
    const result = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
    expect(result.imported).toBe(500);
    const count = await admin.query<{ n: string }>("select count(*)::text as n from members where tenant_id = $1 and member_code like 'BULK-%'", [tenantId]);
    expect(Number(count.rows[0]?.n)).toBe(500);
  }, 120_000);

  it("reserves supplied codes so generated codes in the same file cannot collide", async () => {
    const current = await admin.query<{ n: number }>(
      "select coalesce(max(substring(member_code from '[0-9]+$')::int), 0) as n from members where tenant_id = $1 and member_code ilike 'MEM-%'", [tenantId],
    );
    const supplied = `MEM-${String(current.rows[0]!.n + 1).padStart(4, "0")}`;
    const csv = `full_name,date_of_birth,location,member_code\nReserved,1990-01-01,Worli,${supplied}\nGenerated,1990-01-01,Worli,`;
    const result = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
    expect(result.imported).toBe(2);
    expect(result.importedMembers.map((row) => row.memberCode)).toContain(supplied);
    expect(new Set(result.importedMembers.map((row) => row.memberCode)).size).toBe(2);
  });

  it("rolls back an interrupted file including its consent and audit, then retries safely", async () => {
    const csv = "full_name,date_of_birth,location,member_code\nBefore,1990-01-01,Worli,ROLLBACK-FIRST\nAfter,1990-01-01,Worli,ROLLBACK-ME";
    const beforeMembers = await memberCount(tenantId);
    const beforeConsent = await admin.query<{ n: string }>("select count(*)::text as n from consents where tenant_id = $1", [tenantId]);
    await admin.query(`create function pilot_import_abort() returns trigger language plpgsql as $$ begin
      if new.member_code = 'ROLLBACK-ME' then raise exception 'simulated interruption'; end if;
      return new; end $$`);
    await admin.query("create trigger pilot_import_abort before insert on members for each row execute function pilot_import_abort()");
    try {
      await expect(commitMemberImport({ tenantId, userId: actorId }, csv, attest)).rejects.toThrow(/Failed query: insert into "members"/);
      expect(await memberCount(tenantId)).toBe(beforeMembers);
      const afterConsent = await admin.query<{ n: string }>("select count(*)::text as n from consents where tenant_id = $1", [tenantId]);
      expect(afterConsent.rows[0]?.n).toBe(beforeConsent.rows[0]?.n);
      const audit = await admin.query("select id from audit_log where tenant_id = $1 and after->>'importId' = $2", [tenantId, memberImportIdentity(tenantId, csv)]);
      expect(audit.rowCount).toBe(0);
    } finally {
      await admin.query("drop trigger pilot_import_abort on members");
      await admin.query("drop function pilot_import_abort()");
    }
    const retried = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
    expect(retried.imported).toBe(2);
  });

  it("never overwrites an existing member matched by code", async () => {
    const csv = [
      "full_name,date_of_birth,location,member_code",
      "Different Name,1980-01-01,Worli,IMP-ADULT-1",
    ].join("\n");
    const result = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
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
    const result = await commitMemberImport({ tenantId, userId: actorId }, csv, attest);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toMatchObject({ rowNumber: 2, field: "guardian_name" });
    expect(await memberCount(tenantId)).toBe(before);
  });

  it("keeps tenants isolated", async () => {
    const beforeA = await memberCount(tenantId);
    const result = await commitMemberImport({ tenantId: tenantBId, userId: actorId }, CSV, attest);
    expect(result.imported).toBe(2);
    expect(await memberCount(tenantBId)).toBe(2);
    expect(await memberCount(tenantId)).toBe(beforeA);
  });
});
