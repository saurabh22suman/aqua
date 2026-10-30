// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F2 — the duplicate-delivery window in the WhatsApp dispatch job.
//
// The window this file was written to characterise: the dispatch used to
// call the provider INSIDE the database transaction that records the
// delivery. If the provider sent and the transaction then rolled back, the
// outbox row returned to 'pending' with its attempts counter unchanged —
// and the next minute's run sent the SAME message again.
//
// The approved jobs change closed it: the claim is committed on its own,
// the provider call happens outside every transaction, and the outcome
// write is fenced by the claim token. A send whose outcome write fails
// therefore leaves the row CLAIMED ('sending'), which the next run never
// selects — so each claim results in AT MOST ONE provider call. The
// outcome stays honestly uncertain: a claim nobody finalised becomes
// 'unknown', it is never resent automatically, and a human resolves it.
//
// The reproduction is deterministic and touches no real transport:
//   * the provider is the in-process mock (WHATSAPP_CAPTURE_URL and
//     WHATSAPP_MOCK_URL are unset, so createMockProvider() answers
//     in-process — no network, no message leaves the machine);
//   * the partial failure is a BEFORE INSERT trigger on message_log
//     restricted to this fixture tenant, so the failure happens AFTER the
//     provider call, on the application's own request path, without
//     revoking a privilege every other lane shares.
//
// Agent-owned file.
//
// NOTE: this file pinned the CURRENT (defective) behaviour on purpose. The
// dispatch is now fixed, so the assertion is inverted in the same change:
// the message is sent ONCE, and the uncertainty is surfaced instead of
// being retried.

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

describe("F2 — the WhatsApp dispatch delivers each claim to the provider at most once", () => {
  it("a failed outcome write leaves the row CLAIMED, so the next run does not send again", async () => {
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

    // The provider WAS called — ONCE. The claim was committed in its own
    // transaction, so the row is CLAIMED: not pending (never selectable
    // again), and not sent (the outcome was never recorded).
    expect(providerCalls.bodies).toEqual(["Duplicate evidence"]);
    const afterFailure = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
      sent_at: Date | null;
      claim_token: string | null;
      claimed_at: Date | null;
    }>(
      "select status, attempts, sent_at, claim_token, claimed_at from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(afterFailure.rows[0]!.status).toBe("sending");
    expect(afterFailure.rows[0]!.attempts).toBe(1);
    expect(afterFailure.rows[0]!.sent_at).toBeNull();
    // The fence token identifies THIS claim, and the claim is timed.
    expect(afterFailure.rows[0]!.claim_token).not.toBeNull();
    expect(afterFailure.rows[0]!.claimed_at).not.toBeNull();

    // --- run 2: the claimed row is never selected again -------------
    await runWhatsAppNotificationsJob(tenantId);

    // The provider was NOT called a second time: one claim, at most one
    // provider call.
    expect(providerCalls.bodies).toEqual(["Duplicate evidence"]);
    const afterSecond = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
    }>(
      "select status, attempts from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    // The outcome is still unknown, and the attempt bound did not advance
    // because nothing was sent again.
    expect(afterSecond.rows[0]!.status).toBe("sending");
    expect(afterSecond.rows[0]!.attempts).toBe(1);
  });

  it("a claim nobody finalised is surfaced as 'unknown' and is never resent", async () => {
    // The claim is now older than the dispatcher's claim timeout, so the
    // outcome was never recorded: the message MAY have been delivered.
    // It is surfaced for a human and it is never sent again.
    await privilegedFixturePool.query(
      "update whatsapp_notification_outbox set claimed_at = now() - interval '30 minutes' where tenant_id = $1::uuid",
      [tenantId],
    );
    providerCalls.bodies.length = 0;

    await runWhatsAppNotificationsJob(tenantId);

    // The reaper turned the stale claim into an honest 'unknown'.
    const reaped = await privilegedFixturePool.query<{
      status: string;
      failure_reason: string | null;
      claim_token: string | null;
    }>(
      "select status, failure_reason, claim_token from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(reaped.rows[0]!.status).toBe("unknown");
    expect(reaped.rows[0]!.failure_reason).toBe("outcome_unknown");
    expect(reaped.rows[0]!.claim_token).toBeNull();
    // And it was not resent: no provider call at all.
    expect(providerCalls.bodies).toEqual([]);
  });

  it("the transport was the in-process mock — no message left the machine", async () => {
    // The mock answers in-process (no capture URL is configured), so
    // the send above cost nothing and reached nobody.
    const { env } = await import("@/lib/env");
    expect(env.WHATSAPP_CAPTURE_URL).toBeUndefined();
    expect(env.WHATSAPP_MOCK_URL).toBeUndefined();
    const { resolveProviderName } = await import("@/lib/messaging/provider");
    expect(resolveProviderName()).toBe("mock");
  });
});
