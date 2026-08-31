import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { consents, locations } from "@/db/schema";
import { createMember } from "@/lib/services/register";

// Deliberately NOT named tests/tier1/consent-minor-block.test.ts or
// tests/tier1/consent-withdrawal-immutable.test.ts -- those are files
// #10 and #11 of docs/testing-strategy.md's 15 enumerated Tier 1 files,
// human-owned, "agent may never edit these files." This file is the
// same kind of non-Tier-1 safety net tests/money.test.ts is for
// money-properties.test.ts: proves the behaviour works and that TDD
// red/green is real, not a substitute for whatever the human-owned
// files eventually assert.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
const POLICY_VERSION = "2026.1";

let tenantId = "";
let locationId = "";

beforeAll(async () => {
  tenantId = uuidv7();
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Consent Schema', $3, $4)",
    [tenantId, `consent-schema-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Consent Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

const ADULT_DOB = "1990-01-01";
const MINOR_DOB = "2015-01-01"; // ~11 years old as of 2026

function memberCode(label: string): string {
  return `CON-${RUN}-${label}`;
}

// drizzle wraps the real Postgres error ("duplicate key value violates
// unique constraint ...") in its own Error whose top-level .message is
// just "Failed query: ...", with the actual DB error attached as
// .cause. Asserting against the wrapper's own message would test
// nothing about which constraint fired.
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return e.cause?.message ?? e.message ?? String(err);
  }
}

describe("createMember — an adult self-consents", () => {
  it("succeeds with a processing consent grant, granted_by is the person themselves", async () => {
    const result = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Adult Self",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("adult-1"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(consents).where(eq(consents.personId, result.personId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("processing");
    expect(rows[0].grantedBy).toBe(result.personId); // self
    const evidence = rows[0].evidence as { granterRelationship: string };
    expect(evidence.granterRelationship).toBe("self");
  });

  it("fails without a processing consent grant — no rows created at all", async () => {
    const before = await withTenant(tenantId, (tx) => tx.select().from(consents));

    const result = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Adult No Consent",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("adult-no-consent"),
        consents: [], // no processing grant
      },
    );

    expect(result.ok).toBe(false);

    const after = await withTenant(tenantId, (tx) => tx.select().from(consents));
    expect(after.length).toBe(before.length); // nothing created
  });
});

describe("createMember — a minor requires a guardian and guardian processing consent", () => {
  it("cannot be created without a guardian — blocked, no rows created", async () => {
    const result = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Minor No Guardian",
        dateOfBirth: MINOR_DOB,
        locationId,
        memberCode: memberCode("minor-no-guardian"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/guardian/i);
  });

  it("cannot be created without processing consent, even with a guardian present — blocked, no rows created", async () => {
    const result = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Minor No Consent",
        dateOfBirth: MINOR_DOB,
        locationId,
        memberCode: memberCode("minor-no-consent"),
        guardian: { fullName: "Guardian Of No Consent", relationship: "mother" },
        consents: [], // no processing grant
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/consent/i);
  });

  it("succeeds with a new guardian and processing consent — granted_by is the guardian, not the minor", async () => {
    const result = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Minor Registered",
        dateOfBirth: MINOR_DOB,
        locationId,
        memberCode: memberCode("minor-ok"),
        guardian: { fullName: "Guardian Of Registered", relationship: "father" },
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(consents).where(eq(consents.personId, result.personId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].grantedBy).not.toBe(result.personId); // the guardian, not the minor
    const evidence = rows[0].evidence as { granterName: string; granterRelationship: string };
    expect(evidence.granterName).toBe("Guardian Of Registered");
    expect(evidence.granterRelationship).toBe("father");
  });

  // The server derives minor status from date_of_birth alone. A raw,
  // untyped payload with a bogus extra flag proves the flag has no
  // effect -- createMember's type doesn't even declare such a field, so
  // this exercises the boundary a looser caller (a future action layer
  // forwarding raw body fields carelessly) could actually hit.
  it("ignores a client-submitted isMinor flag entirely — behaviour follows dateOfBirth alone", async () => {
    const raw = JSON.parse(
      JSON.stringify({
        fullName: "Spoofed Adult",
        dateOfBirth: MINOR_DOB, // actually a minor by DOB
        isMinor: false, // lying about it
        locationId,
        memberCode: memberCode("spoofed"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
        // no guardian provided -- if the spoofed flag were honoured,
        // this would be treated as an adult and would succeed
      }),
    );

    const result = await createMember({ tenantId, userId: undefined }, raw);

    // Still blocked: the real DOB says minor, no guardian was provided,
    // and the bogus isMinor:false field changed nothing.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/guardian/i);
  });
});

describe("consents — immutability trigger (db/migrations/0015)", () => {
  let consentId = "";
  let personId = "";
  let otherPersonId = "";

  beforeAll(async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Immutability Subject",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("immutable"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture setup failed: " + created.error);
    personId = created.personId;

    const other = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Someone Else",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("someone-else"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
    if (!other.ok) throw new Error("fixture setup failed: " + other.error);
    otherPersonId = other.personId;

    const { rows } = await admin.query<{ id: string }>(
      "select id from consents where person_id = $1 and purpose = 'processing'",
      [personId],
    );
    consentId = rows[0].id;
  });

  // Trigger checks nine fields against `is distinct from`. Each gets its
  // own case, per the ask: one representative case would only prove the
  // trigger notices SOME change, not that it notices every field it
  // claims to guard.
  //
  // `value` is a closure, not a plain value: this array is built when
  // the describe block is COLLECTED, before beforeAll has run --
  // `otherPersonId` would still be "" at that point if captured
  // directly. Reading it lazily, inside the test body, is what makes
  // this correct rather than a false pass on an empty-string uuid.
  const forbiddenChanges: Array<{ field: string; sql: string; value: () => unknown }> = [
    { field: "id", sql: "id", value: () => uuidv7() },
    { field: "tenant_id", sql: "tenant_id", value: () => uuidv7() },
    { field: "person_id", sql: "person_id", value: () => otherPersonId },
    { field: "purpose", sql: "purpose", value: () => "photography" },
    { field: "granted_by", sql: "granted_by", value: () => otherPersonId },
    { field: "witnessed_by_user_id", sql: "witnessed_by_user_id", value: () => uuidv7() },
    { field: "policy_version", sql: "policy_version", value: () => "not-a-real-version" },
    { field: "granted_at", sql: "granted_at", value: () => new Date(0) },
    { field: "evidence", sql: "evidence", value: () => JSON.stringify({ channel: "tampered" }) },
  ];

  for (const change of forbiddenChanges) {
    it(`rejects changing ${change.field}`, async () => {
      const isJsonb = change.field === "evidence";
      await expect(
        admin.query(
          `update consents set ${change.sql} = $1${isJsonb ? "::jsonb" : ""} where id = $2`,
          [change.value(), consentId],
        ),
      ).rejects.toThrow(/immutable/i);
    });
  }

  it("allows withdrawn_at to go from null to a timestamp", async () => {
    await admin.query("update consents set withdrawn_at = now() where id = $1", [consentId]);
    const { rows } = await admin.query<{ withdrawn_at: Date | null }>(
      "select withdrawn_at from consents where id = $1",
      [consentId],
    );
    expect(rows[0].withdrawn_at).not.toBeNull();
  });

  it("rejects any further change, including to withdrawn_at itself, once withdrawn", async () => {
    await expect(
      admin.query("update consents set withdrawn_at = now() where id = $1", [consentId]),
    ).rejects.toThrow(/already withdrawn/i);
  });
});

describe("consents — at most one active grant per (tenant, person, purpose)", () => {
  it("rejects a second active processing grant for the same person", async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Double Grant Subject",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("double-grant"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture setup failed: " + created.error);

    const message = await rejectionMessage(
      withTenant(tenantId, (tx) =>
        tx.insert(consents).values({
          tenantId,
          personId: created.personId,
          purpose: "processing",
          grantedBy: created.personId,
          policyVersion: POLICY_VERSION,
          evidence: { channel: "duplicate-attempt" },
        }),
      ),
    );
    expect(message).toMatch(/consents_one_active_grant/);
  });

  it("allows a second grant for a DIFFERENT purpose on the same person", async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Multi Purpose Subject",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("multi-purpose"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture setup failed: " + created.error);

    await withTenant(tenantId, (tx) =>
      tx.insert(consents).values({
        tenantId,
        personId: created.personId,
        purpose: "communications",
        grantedBy: created.personId,
        policyVersion: POLICY_VERSION,
        evidence: { channel: "staff-assisted-in-person" },
      }),
    );

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(consents).where(eq(consents.personId, created.personId)),
    );
    expect(rows).toHaveLength(2);
  });

  it("allows a re-grant of the same purpose after the prior grant was withdrawn", async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Regrant Subject",
        dateOfBirth: ADULT_DOB,
        locationId,
        memberCode: memberCode("regrant"),
        consents: [
          {
            purpose: "processing",
            policyVersion: POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture setup failed: " + created.error);

    await admin.query(
      "update consents set withdrawn_at = now() where person_id = $1 and purpose = 'processing'",
      [created.personId],
    );

    await withTenant(tenantId, (tx) =>
      tx.insert(consents).values({
        tenantId,
        personId: created.personId,
        purpose: "processing",
        grantedBy: created.personId,
        policyVersion: POLICY_VERSION,
        evidence: { channel: "re-consented" },
      }),
    );

    const active = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(consents)
        .where(and(eq(consents.personId, created.personId), eq(consents.purpose, "processing"))),
    );
    expect(active).toHaveLength(2); // the withdrawn one plus the new active one -- old row never deleted
  });
});
