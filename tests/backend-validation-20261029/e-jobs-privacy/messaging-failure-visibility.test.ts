// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F4 and F7 — the visibility of a failed tenant notification and the
// attribution of a ledger row.
//
// F4 — a permanently failed tenant notification is VISIBLE. The dispatch
// records the failure on the outbox row AND on the metered ledger row the
// operator surfaces read, so no failure is invisible. The ledger row for a
// definite no-provider failure is MINIMISED: nothing was transmitted, so it
// carries no phone and no body (the tenant-scoped outbox row still holds
// them) and its error is a fixed code rather than prose. The platform
// projection over those rows returns a MASKED phone, NO body and the
// CLASSIFIED reason — never the provider's own text, which can echo the
// recipient's number.
//
// F7 — message_log carries consent_class and person_id, as
// docs/architecture.md:1611-1625 requires: "message_log.consent_class
// records whether the message was essential or suppressible, making
// suppression queryable and auditable rather than implicit in template
// names." The DDL block in the same section lists person_id, so a message
// can be attributed to a person for export or erasure. Both are populated
// from the claim, so the label is carried, not inferred.
//
// Both were EVIDENCE-ONLY findings when this file was written; the approved
// jobs change (db/migrations/20261030062319_whatsapp_outbox_claim_state.sql,
// db/migrations/20261030062320_message_log_failure_visibility.sql and the
// dispatch rework in lib/jobs/whatsapp-notifications-*) made the ledger
// write unconditional and added the columns, so the two cases below now pin
// the APPROVED behaviour.
//
// Agent-owned file.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

// The DISABLED provider: getMessageProvider() returns null, exactly
// as it does in production with an unset WHATSAPP_PROVIDER. Every
// other export of the module is the real one.
vi.mock("@/lib/messaging/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/provider")>();
  return {
    ...actual,
    getMessageProvider: () => null,
  };
});

const { runWhatsAppNotificationsJob } = await import("@/lib/jobs/whatsapp-notifications-job");
const { enqueueMemberNotification } = await import("@/lib/messaging/notification-enqueue");
const { withTenant } = await import("@/db/tenant");
const { listFailedMessages, listRecentMessages } = await import("@/db/platform-messages");
// The RESOLVED provider name — "disabled" in production, "mock" outside it.
// The ledger names the resolved provider, so the assertion follows the
// environment instead of hard-coding one of the two.
const { resolveProviderName } = await import("@/lib/messaging/provider");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const granterId = uuidv7();
const phone = `+9196${String(Date.now()).slice(-8)}`;

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Failure Visibility', 'active', 'Asia/Kolkata')",
    [tenantId, `e-fail-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Fail Child', '1990-01-01', $3), ($4, $2, 'Fail Granter', '1990-01-01', $5)",
    [personId, tenantId, phone, granterId, `+9195${String(Date.now()).slice(-8)}`],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'E-FAIL', 'active')",
    [memberId, tenantId, personId, locationId],
  );
  await privilegedFixturePool.query(
    "insert into policy_versions (version, content) values ($1, $2) on conflict (version) do nothing",
    ["e-fail-v1", "E failure visibility evidence"],
  );
  await privilegedFixturePool.query(
    "insert into consents (id, tenant_id, person_id, purpose, granted_by, policy_version, evidence) values ($1, $2, $3, 'communications', $4, 'e-fail-v1', '{}'::jsonb)",
    [uuidv7(), tenantId, personId, granterId],
  );
});

afterAll(async () => {
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
  await privilegedFixturePool.query("delete from policy_versions where version = $1", ["e-fail-v1"]);
  await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenantId]);
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("F4 — a failed tenant notification is visible to the operator surfaces", () => {
  it("the failure is recorded on the outbox row AND on a minimised ledger row", async () => {
    const queued = await withTenant(tenantId, async (tx) =>
      enqueueMemberNotification(
        tx,
        { tenantId, eventKey: `failure:${RUN}`, body: "Failure visibility" },
        memberId,
      ),
    );
    expect(queued).toBe(1);

    await runWhatsAppNotificationsJob(tenantId);

    // The outbox row records the failed attempt and the CLASSIFIED reason.
    const outbox = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
      error: string | null;
      failure_reason: string | null;
    }>(
      "select status, attempts, error, failure_reason from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(outbox.rows[0]!.status).toBe("failed");
    expect(outbox.rows[0]!.attempts).toBe(1);
    expect(outbox.rows[0]!.error).toBeTruthy();
    expect(outbox.rows[0]!.failure_reason).toBe("no_provider");

    // The metered ledger carries the failure too: the row is ALWAYS
    // written, so a failed send is invisible to no operator surface.
    const ledger = await privilegedFixturePool.query<{
      provider: string;
      to_phone: string | null;
      body: string | null;
      status: string;
      error: string | null;
      category: string;
      cost_paise: string;
      consent_class: string | null;
      person_id: string | null;
      failure_reason: string | null;
    }>(
      "select provider, to_phone, body, status, error, category, cost_paise, consent_class, person_id, failure_reason from message_log where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(ledger.rows).toHaveLength(1);
    const row = ledger.rows[0]!;
    // Nothing was transmitted (there is no provider), so the row is
    // MINIMISED: no phone and no body — the tenant-scoped outbox row
    // still holds them — and its error is a FIXED code, never prose.
    expect(row.to_phone).toBeNull();
    expect(row.body).toBeNull();
    expect(row.error).toBe("no_provider");
    expect(row.failure_reason).toBe("no_provider");
    expect(row.status).toBe("failed");
    expect(row.category).toBe("utility");
    expect(row.cost_paise).toBe("0");
    // The provider named is the RESOLVED one.
    expect(row.provider).toBe(resolveProviderName());

    // The MASKED platform surface shows the failure: a masked phone, no
    // body and the classified reason.
    const failed = (await listFailedMessages(50)).filter(
      (entry) => entry.tenantId === tenantId,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe("failed");
    expect(failed[0]!.failureReason).toBe("no_provider");
    // Nothing was transmitted, so there is no phone to mask.
    expect(failed[0]!.phoneMasked).toBeNull();

    // And the ops console's own list — which reads message_log — shows it
    // too. That row carries no phone and no body, so nothing leaks.
    const opsRows = (await listRecentMessages(50)).filter(
      (entry) => entry.tenantId === tenantId,
    );
    expect(opsRows).toHaveLength(1);
    expect(opsRows[0]!.status).toBe("failed");
    expect(opsRows[0]!.toPhone).toBeNull();
    expect(opsRows[0]!.body).toBeNull();
  });

  it("no surface reads the outbox table", async () => {
    // The mechanical half: the outbox is written by the enqueue path
    // and the dispatch job, and read by neither the ops console nor
    // any tenant page. The approved jobs change adds a MASKED platform
    // PROJECTION (a SECURITY DEFINER function over the table), not a raw
    // table read, so this still holds.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        if (full.includes("/db/schema/")) continue;
        if (full.includes("/lib/messaging/")) continue;
        if (full.includes("/lib/jobs/")) continue;
        if (full.includes("/tests/")) continue;
        if (readFileSync(full, "utf8").includes("whatsapp_notification_outbox")) {
          offenders.push(full);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});

describe("F7 — message_log carries consent_class and person_id", () => {
  it("the columns the architecture requires are present", async () => {
    const columns = await privilegedFixturePool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'message_log'",
    );
    const names = columns.rows.map((r) => r.column_name);
    // docs/architecture.md:1611-1625 — consent_class records whether
    // the message was essential or suppressible.
    expect(names).toContain("consent_class");
    // The same DDL block lists person_id, so a message can be
    // attributed to a person for export or erasure.
    expect(names).toContain("person_id");
    // What IS there.
    expect(names).toContain("category");
    expect(names).toContain("cost_paise");
  });

  it("a suppressible message is labelled suppressible and attributed to its person", async () => {
    // The notification the F4 case queued was NOT essential, so the
    // ledger row says so: the label is carried on the claim, never
    // inferred from a template name.
    const queued = await privilegedFixturePool.query<{
      recipient_person_id: string | null;
      essential: boolean;
    }>(
      "select recipient_person_id, essential from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(queued.rows[0]!.essential).toBe(false);
    const ledger = await privilegedFixturePool.query<{
      consent_class: string | null;
      person_id: string | null;
    }>(
      "select consent_class, person_id from message_log where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]!.consent_class).toBe("suppressible");
    expect(ledger.rows[0]!.person_id).toBe(queued.rows[0]!.recipient_person_id);
  });

  it("an essential message is labelled essential — the label distinguishes the two", async () => {
    const queued = await withTenant(tenantId, async (tx) =>
      enqueueMemberNotification(
        tx,
        {
          tenantId,
          eventKey: `essential:${RUN}`,
          body: "Essential visibility",
          essential: true,
        },
        memberId,
      ),
    );
    expect(queued).toBe(1);

    await runWhatsAppNotificationsJob(tenantId);

    const ledger = await privilegedFixturePool.query<{
      consent_class: string | null;
      person_id: string | null;
    }>(
      "select consent_class, person_id from message_log where tenant_id = $1::uuid",
      [tenantId],
    );
    // The essential notification produced exactly ONE row labelled
    // 'essential'; the earlier suppressible one is still labelled
    // 'suppressible', so the label really does distinguish the two.
    const essential = ledger.rows.filter((r) => r.consent_class === "essential");
    expect(essential).toHaveLength(1);
    expect(ledger.rows.filter((r) => r.consent_class === "suppressible").length).toBeGreaterThan(0);
    // Every ledger row is attributed to a person.
    for (const row of ledger.rows) expect(row.person_id).not.toBeNull();
  });
});
