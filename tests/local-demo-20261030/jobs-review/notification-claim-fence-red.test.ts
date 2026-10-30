// Agent-owned RED specifications — lane E jobs / notification recovery.
//
// OWNER: a-auth lane (independent reviewer). Agent-owned path; nothing under
// tests/tier1/** and no production file is touched by this file.
//
// STATUS: these are the INTENDED REDs for the jobs recovery proposal. They run
// against the CURRENT, UNCHANGED source of
// lib/jobs/whatsapp-notifications-job.ts (byte-identical to the combined
// tree's copy) and against the CURRENT database schema (no E migration
// applied). Every case below is EXPECTED TO FAIL today, each for the one
// reason named in its title. They become GREEN only when the approved jobs
// proposal AND its two migrations land.
//
// WHAT IS BEING SPECIFIED (the four critical guarantees)
//   A1  provider-disabled truth   — with no provider configured, a failed send
//                                   still leaves a MINIMISED ledger row
//                                   (no phone, no body, a fixed code,
//                                   provider='disabled', cost 0).
//   A2  unknown is never retried  — a failure that may have been delivered is
//                                   recorded as 'unknown', and 'unknown' is
//                                   never selected again.
//   A3  the claim fence            — a send whose OUTCOME WRITE fails leaves
//                                   the row CLAIMED, so the next run does not
//                                   call the provider a second time.
//
// The guarantee is stated as BEHAVIOUR (how many provider calls, what the row
// says), never as an implementation detail, so the tests do not dictate the
// shape of the fix.
//
// The provider and the audit writer are MOCKED so the failure injection is
// deterministic. Everything else — the tenant, the member, the consent
// re-check, the outbox row, the ledger, the advisory lock — is the real
// application path.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

// The controllable provider and the controllable outcome writer.
const control = vi.hoisted(() => ({
  providerCalls: 0,
  // null == "no provider configured", which is the PRODUCTION default.
  provider: null as null | {
    name: "mock";
    send: (message: unknown) => Promise<{ providerMessageId: string; status: "sent" }>;
  },
  outcomeWriteFails: false,
}));

vi.mock("@/lib/messaging/provider", () => ({
  MESSAGE_COST_PAISE: { utility: 12n, authentication: 12n, marketing: 90n, service: 0n },
  // The production default when nothing is configured: no provider object.
  getMessageProvider: () => control.provider,
  resolveProviderName: () => "disabled",
  // The explicit "definitely not accepted" error. The class identity comes
  // from this mock, so `instanceof` matches whatever the production code
  // imports from the same module.
  MessageNotAcceptedError: class MessageNotAcceptedError extends Error {
    readonly definitelyNotSent = true as const;
    constructor(message: string) {
      super(message);
      this.name = "MessageNotAcceptedError";
    }
  },
}));

vi.mock("@/lib/audit/write", () => ({
  writeAudit: async () => {
    if (control.outcomeWriteFails) {
      throw new Error("synthetic outcome write failure");
    }
  },
}));

const { runWhatsAppNotificationsJob } = await import("@/lib/jobs/whatsapp-notifications-job");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const phone = "+919876543210";
const body = `Jobs review body ${RUN}`;

let outboxSeq = 0;

async function seedOutboxRow(): Promise<string> {
  outboxSeq += 1;
  const id = uuidv7();
  await privilegedFixturePool.query(
    `insert into whatsapp_notification_outbox
       (id, tenant_id, event_key, member_id, recipient_person_id, phone, body, essential, status, attempts)
     values ($1, $2, $3, $4, $5, $6, $7, true, 'pending', 0)`,
    [id, tenantId, `jobs-review:${RUN}:${outboxSeq}`, memberId, personId, phone, body],
  );
  return id;
}

async function outboxRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await privilegedFixturePool.query(
    `select status, attempts, error
       from whatsapp_notification_outbox where id = $1::uuid`,
    [id],
  );
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  // The claim columns only exist once the approved migration has landed.
  // Read them when they are there, so the assertion below can name the
  // fence token as well as the status.
  try {
    const claim = await privilegedFixturePool.query(
      `select claim_token, claimed_at, failure_reason
         from whatsapp_notification_outbox where id = $1::uuid`,
      [id],
    );
    Object.assign(row, (claim.rows[0] ?? {}) as Record<string, unknown>);
  } catch {
    // The claim columns are not there yet — the status assertion is the RED.
  }
  return row;
}

async function ledgerRows(): Promise<Record<string, unknown>[]> {
  const { rows } = await privilegedFixturePool.query(
    `select provider, to_phone, body, status, error, cost_paise
       from message_log where tenant_id = $1::uuid order by created_at`,
    [tenantId],
  );
  return rows as Record<string, unknown>[];
}

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Jobs Review Tenant', 'active', 'Asia/Kolkata')",
    [tenantId, `jobs-review-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Jobs Review Adult', '1990-01-01', $3)",
    [personId, tenantId, phone],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'JR-1', 'active')",
    [memberId, tenantId, personId, locationId],
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

beforeEach(async () => {
  // Each case starts from an empty outbox and ledger for this tenant, so a
  // provider-call count is exact and never inherits an earlier case's rows.
  await privilegedFixturePool.query(
    "delete from whatsapp_notification_outbox where tenant_id = $1::uuid",
    [tenantId],
  );
  await privilegedFixturePool.query("delete from message_log where tenant_id = $1::uuid", [
    tenantId,
  ]);
  control.providerCalls = 0;
  control.outcomeWriteFails = false;
  control.provider = {
    name: "mock",
    send: async () => {
      control.providerCalls += 1;
      return { providerMessageId: `mock-${control.providerCalls}`, status: "sent" as const };
    },
  };
});

describe("A1 — provider-disabled truth: a failed send must still be visible", () => {
  it("with no provider configured, the ledger still gets a MINIMISED row", async () => {
    control.provider = null; // the production default: nothing configured
    await seedOutboxRow();

    await runWhatsAppNotificationsJob(tenantId);

    const rows = await ledgerRows();
    expect(
      rows.length,
      "a failed send with no provider configured must still leave a ledger row",
    ).toBe(1);
    const row = rows[0]!;
    expect(row.provider).toBe("disabled");
    // Nothing was transmitted, so the row carries no phone and no body.
    expect(row.to_phone).toBeNull();
    expect(row.body).toBeNull();
    // A fixed code, never the provider's own text.
    expect(row.error).toBe("no_provider");
    expect(row.cost_paise).toBe("0");
  });
});

describe("A2 — an outcome that was never recorded must not be retried", () => {
  it("a provider failure that may have been delivered is recorded as 'unknown'", async () => {
    control.provider = {
      name: "mock",
      send: async () => {
        control.providerCalls += 1;
        throw new Error("synthetic transport timeout after the provider may have accepted");
      },
    };
    const id = await seedOutboxRow();

    await runWhatsAppNotificationsJob(tenantId);

    const row = await outboxRow(id);
    expect(
      row.status,
      "a failure that may have been delivered must be 'unknown', never 'failed'",
    ).toBe("unknown");
  });

  it("an 'unknown' row is never selected again, so the provider is called once", async () => {
    control.provider = {
      name: "mock",
      send: async () => {
        control.providerCalls += 1;
        throw new Error("synthetic transport timeout after the provider may have accepted");
      },
    };
    await seedOutboxRow();

    await runWhatsAppNotificationsJob(tenantId);
    await runWhatsAppNotificationsJob(tenantId);

    expect(
      control.providerCalls,
      "an 'unknown' outcome must never be retried automatically",
    ).toBe(1);
  });
});

describe("A3 — the claim fence: a failed outcome write must not resend", () => {
  it("a send whose outcome write fails must not cause a second provider call", async () => {
    control.outcomeWriteFails = true;
    await seedOutboxRow();

    // The outcome write fails, so the run may reject. The guarantee under
    // test is about the NEXT run, not about this one.
    await runWhatsAppNotificationsJob(tenantId).catch(() => undefined);
    await runWhatsAppNotificationsJob(tenantId).catch(() => undefined);

    expect(
      control.providerCalls,
      "a claimed row must not be sent again after a failed outcome write",
    ).toBe(1);
  });

  it("a row whose outcome write failed stays CLAIMED, not pending", async () => {
    control.outcomeWriteFails = true;
    const id = await seedOutboxRow();

    await runWhatsAppNotificationsJob(tenantId).catch(() => undefined);

    const row = await outboxRow(id);
    expect(
      row.status,
      "a row whose outcome was never recorded must stay claimed ('sending')",
    ).toBe("sending");
    if (row.claim_token !== undefined) {
      // The claim columns exist only once the approved migration has landed.
      expect(row.claim_token, "a claimed row must carry the fence token").not.toBeNull();
    }
  });
});
