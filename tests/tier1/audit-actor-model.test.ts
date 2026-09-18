import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import { runSubscriptionsExpireJob } from "@/lib/jobs/subscriptions-expire-job";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// E-01 — audit actor model. Resolves the F-14 blocker (a job has no
// user actor, audit_log.actor_id was NOT NULL) and the F-15 job gap
// (subscriptions.expire mutated with no audit row at all).
//
// This file is the contract for the actor model: actor_type is
// required-with-default, actor_id is nullable, and a job writes
// exactly one row per mutated subscription with source='job'.
//
// The columns do not exist until 20260918060000_e01_audit_actor_model
// lands — the first run of this file is deliberately red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let userId = "";
let locationId = "";
let memberId = "";
let planId = "";
let subscriptionId = "";
let personId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  userId = uuidv7();
  locationId = uuidv7();
  personId = uuidv7();
  memberId = uuidv7();
  planId = uuidv7();
  subscriptionId = uuidv7();

  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Audit Actor Test', 'active')",
    [tenantId, `audit-actor-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `audit-actor-${RUN}`,
  ]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Expiring Member')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenantId, personId, locationId, `AA-${RUN}`],
  );
  await admin.query(
    `insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise)
     values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)`,
    [planId, tenantId, locationId],
  );
  await admin.query(
    `insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status)
     values ($1, $2, $3, $4, $5, current_date - 60, current_date - 1, 'active')`,
    [subscriptionId, tenantId, memberId, planId, locationId],
  );
});

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from subscriptions where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from users where id = $1::uuid", [userId]);
  await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  await admin.end();
});

describe("E-01 — audit actor model columns", () => {
  it("accepts a system actor with no actor_id", async () => {
    const res = await admin.query(
      `insert into audit_log (tenant_id, actor_type, actor_id, action, entity_type, source)
       values ($1, 'job', null, 'probe.system_actor', 'probe', 'job')
       returning id`,
      [tenantId],
    );
    expect(res.rows.length).toBe(1);
  });

  it("defaults actor_type='user' and source='web' so existing writers are untouched", async () => {
    const res = await admin.query<{ actor_type: string; source: string }>(
      `insert into audit_log (tenant_id, actor_id, action, entity_type)
       values ($1, $2, 'member.update', 'member')
       returning actor_type, source`,
      [tenantId, userId],
    );
    expect(res.rows[0]).toEqual({ actor_type: "user", source: "web" });
  });

  it("rejects an unknown actor_type", async () => {
    await expect(
      admin.query(
        `insert into audit_log (tenant_id, actor_type, action, entity_type)
         values ($1, 'robot', 'x', 'y')`,
        [tenantId],
      ),
    ).rejects.toThrow(/audit_log_actor_type_check/);
  });

  it("stores impersonator_id, changed_fields and request_id", async () => {
    const requestId = uuidv7();
    const res = await admin.query<{
      impersonator_id: string;
      changed_fields: string[];
      request_id: string;
    }>(
      `insert into audit_log
         (tenant_id, actor_id, actor_type, action, entity_type, entity_id,
          impersonator_id, changed_fields, request_id, source)
       values ($1, $2, 'support', 'member.update', 'member', $3, $4, $5, $6, 'ops')
       returning impersonator_id, changed_fields, request_id`,
      [tenantId, userId, memberId, userId, ["status", "plan"], requestId],
    );
    expect(res.rows[0]!.impersonator_id).toBe(userId);
    expect(res.rows[0]!.changed_fields).toEqual(["status", "plan"]);
    expect(res.rows[0]!.request_id).toBe(requestId);
  });
});

describe("E-01 — system jobs write audit rows", () => {
  it("subscriptions.expire writes exactly one audit row per expired subscription, actor_type='system'", async () => {
    await runSubscriptionsExpireJob(tenantId);

    const res = await admin.query<{
      actor_type: string;
      actor_id: string | null;
      source: string;
      action: string;
      entity_id: string;
    }>(
      `select actor_type, actor_id, source, action, entity_id
         from audit_log
        where tenant_id = $1::uuid
          and action = 'subscription.expire'`,
      [tenantId],
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0]!;
    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBeNull();
    expect(row.source).toBe("job");
    expect(row.entity_id).toBe(subscriptionId);

    // Idempotence: a second run expires nothing and writes nothing.
    await runSubscriptionsExpireJob(tenantId);
    const again = await admin.query<{ n: number }>(
      `select count(*)::int as n from audit_log
        where tenant_id = $1::uuid and action = 'subscription.expire'`,
      [tenantId],
    );
    expect(again.rows[0]!.n).toBe(1);
  });
});
