// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F2 — EVIDENCE ONLY. The duplicate-delivery window in the WhatsApp
// dispatch job, reproduced with the MOCK transport and a deterministic
// partial failure. No production change is proposed here; the fix
// needs a delivery/locking decision this lane is not authorised to
// take. See the proposal in the lane HANDOFF.
//
// The window: lib/jobs/whatsapp-notifications-job.ts calls the
// provider INSIDE the database transaction that records the delivery.
// If the provider sends and the transaction then rolls back, the
// outbox row returns to 'pending' with its attempts counter
// unchanged — and the next minute's run sends the SAME message
// again.
//
// The reproduction is deterministic and touches no real transport:
//   * the provider is the in-process mock (WHATSAPP_CAPTURE_URL and
//     WHATSAPP_MOCK_URL are unset, so createMockProvider() answers
//     in-process — no network, no message leaves the machine);
//   * the partial failure is a revoked INSERT privilege on
//     message_log, so the failure happens AFTER the provider call and
//     on the application's own request path.
//
// Agent-owned file.
//
// NOTE: this file pins the CURRENT (defective) behaviour on purpose.
// It is a defect-characterisation test, not an acceptance test: the
// first test below asserts that the message IS sent twice. When the
// dispatch is fixed, this file is inverted in the same change — the
// assertion becomes "the message is sent once".

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

// The real provider is used; only its send is counted, so the
// transport under test is the production mock, not a test double.
const providerCalls = vi.hoisted(() => ({ bodies: [] as string[] }));
vi.mock("@/lib/messaging/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/provider")>();
  return {
    ...actual,
    getMessageProvider: (config?: Parameters<typeof actual.getMessageProvider>[0]) => {
      const provider = actual.getMessageProvider(config);
      if (!provider) return null;
      return {
        name: provider.name,
        async send(message: Parameters<typeof provider.send>[0]) {
          providerCalls.bodies.push(message.body);
          return provider.send(message);
        },
      };
    },
  };
});

const { runWhatsAppNotificationsJob } = await import("@/lib/jobs/whatsapp-notifications-job");
const { enqueueMemberNotification } = await import("@/lib/messaging/notification-enqueue");
const { withTenant } = await import("@/db/tenant");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const granterId = uuidv7();
const phone = `+9198${String(Date.now()).slice(-8)}`;

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Duplicate', 'active', 'Asia/Kolkata')",
    [tenantId, `e-dup-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Dup Child', '1990-01-01', $3), ($4, $2, 'Dup Granter', '1990-01-01', $5)",
    [personId, tenantId, phone, granterId, `+9197${String(Date.now()).slice(-8)}`],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'E-DUP', 'active')",
    [memberId, tenantId, personId, locationId],
  );
  // A communications consent, so the notification is not suppressed.
  await privilegedFixturePool.query(
    "insert into policy_versions (version, content) values ($1, $2) on conflict (version) do nothing",
    ["e-dup-v1", "E duplicate evidence"],
  );
  await privilegedFixturePool.query(
    "insert into consents (id, tenant_id, person_id, purpose, granted_by, policy_version, evidence) values ($1, $2, $3, 'communications', $4, 'e-dup-v1', '{}'::jsonb)",
    [uuidv7(), tenantId, personId, granterId],
  );
});

afterAll(async () => {
  await disarmMessageLogFault();
  await deleteAuditRowsForTenant(privilegedFixturePool, tenantId);
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
  await privilegedFixturePool.query("delete from policy_versions where version = $1", ["e-dup-v1"]);
  await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenantId]);
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

/**
 * Make the metered-row write fail AT THE DATABASE, for this fixture
 * tenant only. The trigger is restricted to this tenant, so no shared
 * privilege is revoked and no other lane's or test's message_log write
 * is affected — the fault is injected at the row, not at the role.
 */
async function armMessageLogFault(): Promise<void> {
  await privilegedFixturePool.query("drop trigger if exists e_dup_message_log_fault on message_log");
  await privilegedFixturePool.query("drop function if exists e_dup_message_log_fault()");
  await privilegedFixturePool.query(`create function e_dup_message_log_fault() returns trigger language plpgsql as $$ begin
      if new.tenant_id = '${tenantId}'::uuid then
        raise exception 'e-jobs-privacy message log fault';
      end if;
      return new; end $$`);
  await privilegedFixturePool.query(
    "create trigger e_dup_message_log_fault before insert on message_log for each row execute function e_dup_message_log_fault()",
  );
}

async function disarmMessageLogFault(): Promise<void> {
  await privilegedFixturePool.query("drop trigger if exists e_dup_message_log_fault on message_log");
  await privilegedFixturePool.query("drop function if exists e_dup_message_log_fault()");
}

describe("F2 — the WhatsApp dispatch can deliver the same message twice", () => {
  it("a rollback after a successful provider send leaves the message to be sent again", async () => {
    providerCalls.bodies.length = 0;

    const queued = await withTenant(tenantId, async (tx) =>
      enqueueMemberNotification(
        tx,
        { tenantId, eventKey: `evidence:${RUN}`, body: "Duplicate evidence" },
        memberId,
      ),
    );
    expect(queued).toBe(1);

    // --- run 1: the provider succeeds, the metered row write fails ----
    // The fault is injected with a trigger restricted to THIS fixture
    // tenant, so the failure happens on the application's own request
    // path without revoking a privilege every other lane shares.
    await armMessageLogFault();
    try {
      await expect(runWhatsAppNotificationsJob(tenantId)).rejects.toThrow();
    } finally {
      await disarmMessageLogFault();
    }

    // The provider WAS called, and the outbox row rolled back with the
    // transaction: still pending, still with no attempt recorded.
    expect(providerCalls.bodies).toEqual(["Duplicate evidence"]);
    const afterFailure = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
      sent_at: Date | null;
    }>(
      "select status, attempts, sent_at from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(afterFailure.rows[0]!.status).toBe("pending");
    expect(afterFailure.rows[0]!.attempts).toBe(0);
    expect(afterFailure.rows[0]!.sent_at).toBeNull();

    // --- run 2: the same queued message goes out again ---------------
    await runWhatsAppNotificationsJob(tenantId);

    expect(providerCalls.bodies).toEqual(["Duplicate evidence", "Duplicate evidence"]);

    const afterSecond = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
    }>(
      "select status, attempts from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(afterSecond.rows[0]!.status).toBe("sent");
    expect(afterSecond.rows[0]!.attempts).toBe(1);
  });

  it("the transport was the in-process mock — no message left the machine", async () => {
    // The mock answers in-process (no capture URL is configured), so
    // the two sends above cost nothing and reached nobody.
    const { env } = await import("@/lib/env");
    expect(env.WHATSAPP_CAPTURE_URL).toBeUndefined();
    expect(env.WHATSAPP_MOCK_URL).toBeUndefined();
    const { resolveProviderName } = await import("@/lib/messaging/provider");
    expect(resolveProviderName()).toBe("mock");
  });
});
