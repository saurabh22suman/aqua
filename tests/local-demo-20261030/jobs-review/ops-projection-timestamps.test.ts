// @vitest-environment node
//
// Agent-owned regression — the Ops platform projections must return ISO
// timestamp strings.
//
// THE DEFECT this file reproduces (first observed in the FOCUSED FOLLOW-UP
// to CI run 41071986033 — that run itself failed on the ledger-row count
// ("expected 1 to be +0") and reached this path only after the F4 case was
// strengthened; the TypeError surfaced in the focused rerun, through the
// F4 case of
// tests/backend-validation-20261029/e-jobs-privacy/messaging-failure-visibility.test.ts):
//
//   TypeError: row.created_at.toISOString is not a function
//   ❯ db/platform-messages.ts:95:33
//
// WHY IT HAPPENS — the DRIVER, not the schema:
//
// Both platform projections are read with a RAW sql template:
//
//   db/platform-messages.ts:58-71       tx.execute(sql`select … from ops_failed_messages(…)`)
//   db/platform-notifications.ts:49-62  tx.execute(sql`select … from ops_notification_attention(…)`)
//
// Drizzle's node-postgres driver OVERRIDES pg's type parsers so that the
// date/time types come back as the server's TEXT (see the `types` override
// on the raw query config in
// node_modules/drizzle-orm/node-postgres/session.js:
// `if (typeId === types.builtins.TIMESTAMPTZ) return (val) => val;`).
// A SCHEMA-mapped query re-maps that text through Drizzle's own timestamp
// mapper; a RAW query has no fields to map, so it returns the rows
// untouched. `row.created_at` is therefore the string
// "2026-01-02 03:04:05.678+00" — and `.toISOString()` on it is not a
// function. The same raw mapping pattern exists in
// db/platform-notifications.ts, where `claimed_at` and `created_at` are
// both converted with `.toISOString()`.
//
// WHAT THIS FILE PROVES — the smallest reproduction that does NOT mock the
// driver away:
//
//   * the REAL application helpers read through the REAL app role, the
//     REAL platform-admin scope and the REAL SECURITY DEFINER projections;
//   * both of them return their timestamp columns as ISO strings carrying
//     the EXACT instant that was stored;
//   * the rows they return carry ONLY the allowed columns — no message
//     body, no raw phone number, no raw provider error, no event key.
//
// Fixture setup and cleanup use the privileged fixture pool (the same
// pattern as the sibling masked-read spec); every READ goes through the
// application. No provider is called, no notification is dispatched and no
// credential is minted.
//
// Agent-owned file. Nothing under tests/tier1/** is touched.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { listFailedMessages } from "@/db/platform-messages";
import { listNotificationsNeedingAttention } from "@/db/platform-notifications";

const RUN = Date.now().toString(36);

// Strictly this file's identifiers. Nothing here may collide with another
// fixture's rows, and every row this file creates is removed again.
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const granterId = uuidv7();
const memberId = uuidv7();
const messageLogId = uuidv7();
const outboxId = uuidv7();

const phone = `+9198${String(Date.now()).slice(-8)}`;
const granterPhone = `+9197${String(Date.now()).slice(-8)}`;
const body = `Projection timestamp body ${RUN}`;
// A provider error that ECHOES the recipient's number — the leak the
// masking exists to stop.
const providerError = `synthetic provider timeout while sending to ${phone}`;
// The event KEY carries a token-derived identifier; only its KIND may
// cross the platform boundary.
const eventKey = `staff-login-link:${RUN}-jti`;

// The stored instants. They are captured with MILLISECOND precision,
// which is what both PostgreSQL's text rendering and JavaScript keep, so
// the expected ISO string is EXACT. They are also recent, so the fixture
// rows are the newest qualifying rows and are inside the projection's
// own LIMIT.
const ledgerCreatedAt = new Date();
const outboxCreatedAt = new Date();
const claimedAt = new Date();

// JavaScript's ISO form: four-digit year, milliseconds, Z.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The allowed output shapes. A projection that added a column would leak
// something; these lists pin what may cross the platform boundary.
const FAILED_MESSAGE_KEYS = [
  "category",
  "consentClass",
  "createdAt",
  "failureReason",
  "id",
  "phoneMasked",
  "provider",
  "status",
  "tenantId",
  "tenantName",
];
const ATTENTION_ROW_KEYS = [
  "attempts",
  "claimedAt",
  "createdAt",
  "eventKind",
  "failureReason",
  "id",
  "phoneMasked",
  "status",
  "tenantId",
  "tenantName",
];

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Ops projection timestamps', 'active', 'Asia/Kolkata')",
    [tenantId, `ops-projection-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Projection Child', '1990-01-01', $3), ($4, $2, 'Projection Granter', '1990-01-01', $5)",
    [personId, tenantId, phone, granterId, granterPhone],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'PROJ-TS', 'active')",
    [memberId, tenantId, personId, locationId],
  );
  await privilegedFixturePool.query(
    "insert into policy_versions (version, content) values ($1, $2) on conflict (version) do nothing",
    [`proj-ts-${RUN}`, "Ops projection timestamp fixture"],
  );
  await privilegedFixturePool.query(
    "insert into consents (id, tenant_id, person_id, purpose, granted_by, policy_version, evidence) values ($1, $2, $3, 'communications', $4, $5, '{}'::jsonb)",
    [uuidv7(), tenantId, personId, granterId, `proj-ts-${RUN}`],
  );

  // The FAILED ledger row the "failed sends" projection must return. Its
  // own created_at is set EXPLICITLY, so the expected ISO string is known.
  await privilegedFixturePool.query(
    `insert into message_log
       (id, tenant_id, direction, provider, to_phone, body, status, error, category,
        cost_paise, currency, consent_class, person_id, failure_reason, created_at, updated_at)
     values ($1, $2, 'outbound', 'mock', $3, $4, 'failed', $5, 'utility',
             0, 'INR', 'essential', $6, 'provider_rejected', $7, $7)`,
    [messageLogId, tenantId, phone, body, providerError, personId, ledgerCreatedAt],
  );

  // The UNKNOWN outbox row the "needs attention" projection must return,
  // with a NON-NULL claimed_at: the claim is what makes the outcome
  // uncertain, and the projection exposes its timestamp.
  await privilegedFixturePool.query(
    `insert into whatsapp_notification_outbox
       (id, tenant_id, event_key, member_id, recipient_person_id, phone, body, essential,
        audience, status, attempts, error, failure_reason, claimed_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, true, 'selected', 'unknown', 5, $8, 'outcome_unknown', $9, $10)`,
    [
      outboxId,
      tenantId,
      eventKey,
      memberId,
      personId,
      phone,
      body,
      providerError,
      claimedAt,
      outboxCreatedAt,
    ],
  );
});

afterAll(async () => {
  for (const table of [
    "whatsapp_notification_outbox",
    "message_log",
    "consents",
    "members",
    "persons",
    "locations",
  ]) {
    await privilegedFixturePool.query(
      `delete from ${table} where tenant_id = $1::uuid`,
      [tenantId],
    );
  }
  await privilegedFixturePool.query("delete from policy_versions where version = $1", [
    `proj-ts-${RUN}`,
  ]);
  await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenantId]);
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("the Ops platform projections return ISO timestamp strings", () => {
  it("listFailedMessages returns the failed row with an exact ISO createdAt", async () => {
    const rows = await listFailedMessages(200);
    const mine = rows.filter((row) => row.tenantId === tenantId);
    // The case must not pass on an empty result: the fixture row has to be
    // there, identified by its own id.
    expect(mine).toHaveLength(1);
    const row = mine[0]!;
    expect(row.id).toBe(messageLogId);

    // The timestamp is an ISO string with the EXACT stored instant.
    expect(typeof row.createdAt).toBe("string");
    expect(row.createdAt).toMatch(ISO);
    expect(row.createdAt).toBe(ledgerCreatedAt.toISOString());

    // The allowed output shape, and nothing else.
    expect(Object.keys(row).sort()).toEqual(FAILED_MESSAGE_KEYS);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("provider_rejected");
    expect(row.consentClass).toBe("essential");

    // No body, no raw phone number and no raw provider text cross the
    // platform boundary.
    const payload = JSON.stringify(row);
    expect(payload.includes(phone)).toBe(false);
    expect(payload.includes(body)).toBe(false);
    expect(payload.includes(providerError)).toBe(false);
  });

  it("listNotificationsNeedingAttention returns the unknown row with exact ISO timestamps", async () => {
    const rows = await listNotificationsNeedingAttention(200);
    const mine = rows.filter((row) => row.tenantId === tenantId);
    expect(mine).toHaveLength(1);
    const row = mine[0]!;
    expect(row.id).toBe(outboxId);

    // BOTH timestamps are ISO strings with the EXACT stored instants. The
    // claim is what makes the outcome uncertain, so claimed_at is not
    // null here.
    expect(typeof row.createdAt).toBe("string");
    expect(row.createdAt).toMatch(ISO);
    expect(row.createdAt).toBe(outboxCreatedAt.toISOString());
    expect(row.claimedAt).not.toBeNull();
    expect(typeof row.claimedAt).toBe("string");
    expect(row.claimedAt).toMatch(ISO);
    expect(row.claimedAt).toBe(claimedAt.toISOString());

    // The allowed output shape, and nothing else.
    expect(Object.keys(row).sort()).toEqual(ATTENTION_ROW_KEYS);
    expect(row.status).toBe("unknown");
    expect(row.attempts).toBe(5);
    expect(row.failureReason).toBe("outcome_unknown");
    // Only the event KIND, never the event key.
    expect(row.eventKind).toBe("staff-login-link");

    // No body, no raw phone number, no raw provider text and no
    // token-derived identifier cross the platform boundary.
    const payload = JSON.stringify(row);
    expect(payload.includes(phone)).toBe(false);
    expect(payload.includes(body)).toBe(false);
    expect(payload.includes(providerError)).toBe(false);
    expect(payload.includes(`${RUN}-jti`)).toBe(false);
  });
});
