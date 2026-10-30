// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F4 and F7 — EVIDENCE ONLY. Two concrete, measured facts about the
// messaging ledger, so the proposals that follow rest on evidence
// rather than on an inference from a service signature.
//
// F4 — a permanently failed tenant notification leaves no trace on any
// operator surface. The dispatch job records the failure on the OUTBOX
// row, but the only messaging surface the product has
// (app/(platform)/ops/whatsapp/page.tsx) lists the message_log. When
// the provider is absent — the PRODUCTION default, since
// lib/messaging/provider.ts resolves an unset WHATSAPP_PROVIDER to
// "disabled" in production — the dispatch writes no message_log row at
// all, so the failure is invisible.
//
// F7 — message_log carries no consent_class and no person_id.
// docs/architecture.md:1611-1625 requires: "message_log.consent_class
// records whether the message was essential or suppressible, making
// suppression queryable and auditable rather than implicit in template
// names." The column does not exist, so a metered message cannot be
// told apart from a suppressed one after the fact.
//
// Both need a schema or product decision this lane is not authorised
// to take; the proposals are in the lane HANDOFF.
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
const { listRecentMessages } = await import("@/db/platform-messages");

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

describe("F4 — a failed tenant notification is invisible to every operator surface", () => {
  it("the failure is recorded on the outbox row and nowhere else", async () => {
    const queued = await withTenant(tenantId, async (tx) =>
      enqueueMemberNotification(
        tx,
        { tenantId, eventKey: `failure:${RUN}`, body: "Failure visibility" },
        memberId,
      ),
    );
    expect(queued).toBe(1);

    await runWhatsAppNotificationsJob(tenantId);

    const outbox = await privilegedFixturePool.query<{
      status: string;
      attempts: number;
      error: string | null;
    }>(
      "select status, attempts, error from whatsapp_notification_outbox where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(outbox.rows[0]!.status).toBe("failed");
    expect(outbox.rows[0]!.attempts).toBe(1);
    expect(outbox.rows[0]!.error).toBeTruthy();

    // The metered ledger has NO row: the dispatch only writes one when
    // a provider object exists (lib/jobs/whatsapp-notifications-job.ts
    // guards the insert with `if (provider)`).
    const logged = await privilegedFixturePool.query<{ n: number }>(
      "select count(*)::int as n from message_log where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(logged.rows[0]!.n).toBe(0);

    // And the only messaging surface the product has — the ops
    // WhatsApp console, which reads message_log — therefore shows
    // nothing about this failure.
    const opsRows = (await listRecentMessages(50)).filter(
      (row) => row.tenantId === tenantId,
    );
    expect(opsRows).toEqual([]);
  });

  it("no surface reads the outbox table", async () => {
    // The mechanical half: the outbox is written by the enqueue path
    // and the dispatch job, and read by neither the ops console nor
    // any tenant page.
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

describe("F7 — message_log carries no consent_class and no person_id", () => {
  it("the columns the architecture requires are absent", async () => {
    const columns = await privilegedFixturePool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'message_log'",
    );
    const names = columns.rows.map((r) => r.column_name);
    // docs/architecture.md:1611-1625 — consent_class records whether
    // the message was essential or suppressible.
    expect(names).not.toContain("consent_class");
    // The same DDL block lists person_id, so a message can be
    // attributed to a person for export or erasure.
    expect(names).not.toContain("person_id");
    // What IS there.
    expect(names).toContain("category");
    expect(names).toContain("cost_paise");
  });
});
