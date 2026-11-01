// Agent-owned RED specifications — the MASKED platform recovery reads.
//
// OWNER: a-auth lane (independent reviewer). Agent-owned path; nothing under
// tests/tier1/** and no production file is touched by this file.
//
// STATUS: the INTENDED REDs for the masked platform reads, written BEFORE the
// approved jobs change. They run against the CURRENT, UNCHANGED source and the
// CURRENT database schema, and are EXPECTED TO FAIL today.
//
// HOW THESE CASES ARE WRITTEN (deliberately)
//   Each case goes through the READ PATH the approved change introduces — the
//   platform projection the operator console reads — and asserts on the DATA
//   that comes back. Nothing here asserts that a module or an export exists:
//   an absent export is not evidence of a defect, so it is not used as one.
//   The seeded rows carry a recipient phone number, a message body and a
//   provider error that ECHOES the phone number, so the masking assertions are
//   observable rather than formal.
//
//   Today the read path raises, because the projection the read depends on is
//   not in the database yet. That is the product state under test: the
//   operator console has no masked way to see a failed notification.
//
// WHAT IS BEING SPECIFIED
//   M1  the failed-notification read returns the failed row, MASKED: a masked
//       phone, no body, no provider text, a CLASSIFIED reason.
//   M2  the needs-attention read returns the exhausted row, MASKED, and only
//       the event KIND (never the staff-login-link jti).
//   M3  outside the platform scope both reads return ZERO rows: the tenant
//       runtime must not be able to enumerate another tenant's notifications.
//
// The pre-existing raw `db/platform-messages.ts#listRecentMessages` surface is
// deliberately NOT asserted here: the approved change does not redesign it, and
// it is an explicit human privacy open item, not a defect of this packet.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/scope";
import { withTenant } from "@/db/tenant";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const phone = "+919876543210";
const body = `Masked read body ${RUN}`;
// A provider error that echoes the recipient's number — the leak the masking
// exists to stop.
const providerError = `synthetic provider timeout while sending to ${phone}`;

const CLOSED_REASONS = ["no_provider", "provider_rejected", "not_allowed", "outcome_unknown"];

type Row = Record<string, unknown>;

/** The platform scope: what the operator console reads through. */
async function platformRead(statement: string): Promise<Row[]> {
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql.raw(statement));
    return (result as unknown as { rows: Row[] }).rows;
  });
}

/** A tenant-scoped session: the runtime role, outside the platform scope. */
async function tenantRead(statement: string): Promise<Row[]> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.execute(sql.raw(statement));
    return (result as unknown as { rows: Row[] }).rows;
  });
}

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Masked Read Tenant', 'active', 'Asia/Kolkata')",
    [tenantId, `masked-read-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Masked Read Adult', '1990-01-01', $3)",
    [personId, tenantId, phone],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'MR-1', 'active')",
    [memberId, tenantId, personId, locationId],
  );
  // A failed ledger row: the operator must be able to see that the send
  // failed, and must NOT be handed the recipient's number, the body or the
  // provider's own text.
  await privilegedFixturePool.query(
    `insert into message_log
       (tenant_id, direction, provider, to_phone, body, status, error, category)
     values ($1, 'outbound', 'mock', $2, $3, 'failed', $4, 'utility')`,
    [tenantId, phone, body, providerError],
  );
  // An exhausted outbox row: a notification that has failed MAX_ATTEMPTS
  // times is the terminal state an operator has to be able to see.
  await privilegedFixturePool.query(
    `insert into whatsapp_notification_outbox
       (id, tenant_id, event_key, member_id, recipient_person_id, phone, body, essential, status, attempts, error)
     values ($1, $2, $3, $4, $5, $6, $7, true, 'failed', 5, $8)`,
    [uuidv7(), tenantId, `masked-read:${RUN}`, memberId, personId, phone, body, providerError],
  );
});

afterAll(async () => {
  await deleteAuditRowsForTenant(privilegedFixturePool, tenantId);
  for (const table of ["whatsapp_notification_outbox", "message_log", "members", "persons", "locations"]) {
    await privilegedFixturePool.query(`delete from ${table} where tenant_id = $1::uuid`, [tenantId]);
  }
  await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenantId]);
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("M1 — the failed-notification read must mask", () => {
  it("returns the failed row with a masked phone, no body and a classified reason", async () => {
    const rows = await platformRead(`select * from ops_failed_messages(50)`);

    expect(
      rows.length,
      "the failed notification must be visible to the platform operator",
    ).toBeGreaterThan(0);
    const row = rows[0]!;
    // The phone is masked: the digits survive only at the edges.
    expect(String(row.phone_masked)).toContain("•");
    expect(String(row.phone_masked)).not.toContain(phone);
    // No body and no provider text ever cross the platform boundary.
    expect(row.body, "the masked read must never carry a message body").toBeUndefined();
    expect(row.error, "the masked read must never carry the provider's own error text").toBeUndefined();
    // What is shown instead of the provider's text is a reason from a closed
    // set. A row written before the change carries no reason at all, which is
    // allowed — but nothing that is NOT a closed-set reason may appear.
    const reason =
      row.failure_reason === null || row.failure_reason === undefined
        ? null
        : String(row.failure_reason);
    if (reason !== null) expect(CLOSED_REASONS).toContain(reason);
    // The whole row must be free of the recipient's number and of the body.
    expect(JSON.stringify(row), "the masked read must not carry the recipient's number").not.toContain(phone);
    expect(JSON.stringify(row), "the masked read must not carry the message body").not.toContain(body);
  });
});

describe("M2 — the needs-attention read must mask", () => {
  it("returns the exhausted notification with a masked phone and only the event kind", async () => {
    const rows = await platformRead(`select * from ops_notification_attention(50)`);

    expect(
      rows.length,
      "the exhausted notification must be visible to the platform operator",
    ).toBeGreaterThan(0);
    const row = rows[0]!;
    expect(String(row.phone_masked)).toContain("•");
    expect(String(row.phone_masked)).not.toContain(phone);
    expect(row.body, "the masked read must never carry a message body").toBeUndefined();
    expect(row.error, "the masked read must never carry the provider's own error text").toBeUndefined();
    // The event KEY carries a token-derived identifier (a staff-login-link jti).
    // Only its KIND may cross the platform boundary.
    expect(String(row.event_kind ?? "")).not.toContain(":");
    expect(row.event_key, "the masked read must carry the event kind, never the event key").toBeUndefined();
    // The whole row must be free of the recipient's number and of the body.
    expect(JSON.stringify(row), "the masked read must not carry the recipient's number").not.toContain(phone);
    expect(JSON.stringify(row), "the masked read must not carry the message body").not.toContain(body);
  });
});

describe("M3 — outside the platform scope both reads return nothing", () => {
  it("the failed-notification read returns zero rows to a tenant-scoped session", async () => {
    const rows = await tenantRead(`select * from ops_failed_messages(50)`);
    expect(
      rows.length,
      "a tenant-scoped runtime must not be able to enumerate another tenant's failed notifications",
    ).toBe(0);
  });

  it("the needs-attention read returns zero rows to a tenant-scoped session", async () => {
    const rows = await tenantRead(`select * from ops_notification_attention(50)`);
    expect(
      rows.length,
      "a tenant-scoped runtime must not be able to enumerate another tenant's attention list",
    ).toBe(0);
  });
});
