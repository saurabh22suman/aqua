import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import {
  transitionTenantStatus,
  type TransitionInput,
  type TransitionResult,
} from "@/db/platform-tenant-status";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// Phase 1.6 — service-level proof for transitionTenantStatus().
// One transaction: lock the row (SELECT FOR UPDATE), validate the
// transition, UPDATE tenants.status, INSERT platform_audit_log.
// State machine guards reject impossible edges (churned → * is
// terminal, no-change is a distinct code, no reason = no go).
//
// Tests within this file run in parallel (vitest default). Each
// test seeds its own tenant id (uuid v7) under a run-scoped
// slug prefix so the unique constraint doesn't collide.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `transition-${RUN}`;

let actorId: UserId;
const created: TenantId[] = [];

beforeAll(async () => {
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Test Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [uuidv7(), `transition-actor-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`transition-actor-${RUN}@platform.test`],
  );
  actorId = asUserId(actor.rows[0]!.id);
});

afterAll(async () => {
  // Cascade deletes from tenants (no FK targets here, but clean up
  // audit and tenants rows explicitly so a stuck rerun doesn't
  // collide on a stale audit row).
  if (created.length > 0) {
    const ids = created.map((t) => t as unknown as string);
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [ids]);
  }
  await admin.query(
    "delete from platform_users where email = $1",
    [`transition-actor-${RUN}@platform.test`],
  );
  await admin.end();
});

let counter = 0;
async function seedTenant(
  status: "trial" | "active" | "suspended" | "churned",
): Promise<TenantId> {
  counter += 1;
  const id = asTenantId(uuidv7());
  const slug = `${SLUG_PREFIX}-${counter}`;
  await admin.query(
    `insert into tenants (id, slug, name, status)
     values ($1, $2, $3, $4)`,
    [id, slug, "Transition Test", status],
  );
  created.push(id);
  return id;
}

async function expectOk(
  result: TransitionResult,
): Promise<{ tenantId: TenantId; previousStatus: string }> {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error(`expected ok, got ${result.kind}`);
  }
  return {
    tenantId: result.tenantId,
    previousStatus: result.previousStatus,
  };
}

async function expectError(
  result: TransitionResult,
  code:
    | "invalid"
    | "tenant_not_found"
    | "terminal_state"
    | "no_change"
    | "reason_required",
): Promise<void> {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
}

const BASE_INPUT: TransitionInput = {
  targetStatus: "active",
};

describe("transitionTenantStatus", () => {
  it("trial → active: writes the row update and the audit row in one transaction", async () => {
    const tenantId = await seedTenant("trial");
    const result = await transitionTenantStatus(tenantId, BASE_INPUT, {
      actorId,
    });
    const ok = await expectOk(result);
    expect(ok.previousStatus).toBe("trial");

    // Row 1: status moved, updatedBy carries the actor id.
    const tenant = (
      await admin.query<{ status: string; updated_by: string }>(
        "select status, updated_by from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(tenant.status).toBe("active");
    expect(tenant.updated_by).toBe(actorId);

    // Row 2: audit row with the right action + detail.
    const audit = (
      await admin.query<{
        actor_id: string;
        action: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, action, detail
         from platform_audit_log
         where tenant_id = $1 and action = 'tenant.activate'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.actor_id).toBe(actorId);
    expect(audit.detail).toMatchObject({ from: "trial", to: "active" });
  });

  it("active → suspended: requires a reason (rejected without one)", async () => {
    const tenantId = await seedTenant("active");
    await expectError(
      await transitionTenantStatus(
        tenantId,
        { targetStatus: "suspended" },
        { actorId },
      ),
      "reason_required",
    );
    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    // Status unchanged — the rejected path writes nothing.
    expect(row.status).toBe("active");
  });

  it("active → suspended: with reason, writes the row and a reason-bearing audit", async () => {
    const tenantId = await seedTenant("active");
    const reason = "non-payment — admin manually paused";
    const result = await transitionTenantStatus(
      tenantId,
      { targetStatus: "suspended", reason },
      { actorId },
    );
    await expectOk(result);

    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("suspended");

    const audit = (
      await admin.query<{
        action: string;
        detail: Record<string, unknown>;
      }>(
        `select action, detail
         from platform_audit_log where tenant_id = $1 and action = 'tenant.suspend'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.detail).toMatchObject({
      from: "active",
      to: "suspended",
      reason,
    });
  });

  it("suspended → active: reactivation via the same activate action; audit detail carries from='suspended'", async () => {
    const tenantId = await seedTenant("suspended");
    const result = await transitionTenantStatus(tenantId, BASE_INPUT, {
      actorId,
    });
    await expectOk(result);

    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("active");

    const audit = (
      await admin.query<{ detail: Record<string, unknown> }>(
        `select detail from platform_audit_log
         where tenant_id = $1 and action = 'tenant.activate'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.detail).toMatchObject({ from: "suspended", to: "active" });
  });

  it("churned → active: rejected as terminal_state (churned is terminal)", async () => {
    const tenantId = await seedTenant("churned");
    await expectError(
      await transitionTenantStatus(tenantId, BASE_INPUT, { actorId }),
      "terminal_state",
    );
    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("churned");
  });

  it("churned → suspended: also terminal — no transitions out of churned", async () => {
    const tenantId = await seedTenant("churned");
    await expectError(
      await transitionTenantStatus(
        tenantId,
        { targetStatus: "suspended", reason: "anything" },
        { actorId },
      ),
      "terminal_state",
    );
  });

  it("no-op transition (active → active) is rejected with code 'no_change'", async () => {
    const tenantId = await seedTenant("active");
    await expectError(
      await transitionTenantStatus(tenantId, BASE_INPUT, { actorId }),
      "no_change",
    );
    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("active");
  });

  it("unknown tenant id is rejected with 'tenant_not_found'", async () => {
    const fakeId = asTenantId("00000000-0000-0000-0000-000000000000");
    await expectError(
      await transitionTenantStatus(fakeId, BASE_INPUT, { actorId }),
      "tenant_not_found",
    );
  });

  it("invalid input (targetStatus outside enum) is rejected with 'invalid'", async () => {
    const tenantId = await seedTenant("trial");
    await expectError(
      // Bypass the type system on purpose — Zod's runtime should
      // catch it; this is the kind of input a malicious client
      // could send. The TypeScript signature isn't a guard.
      await transitionTenantStatus(
        tenantId,
        // @ts-expect-error — runtime check matters
        { targetStatus: "bogus" },
        { actorId },
      ),
      "invalid",
    );
    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("trial");
  });

  it("churn also requires a reason and writes it to the audit detail", async () => {
    const tenantId = await seedTenant("active");
    const reason = "tenant signed off after acquisition";
    const result = await transitionTenantStatus(
      tenantId,
      { targetStatus: "churned", reason },
      { actorId },
    );
    await expectOk(result);
    const row = (
      await admin.query<{ status: string }>(
        "select status from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(row.status).toBe("churned");
    const audit = (
      await admin.query<{ detail: Record<string, unknown> }>(
        `select detail from platform_audit_log where tenant_id = $1 and action = 'tenant.churn'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.detail).toMatchObject({
      from: "active",
      to: "churned",
      reason,
    });
  });

  it("atomicity proof: skipping the audit insert breaks the test that asserts the audit row", async () => {
    // The structural invariant already pinned elsewhere in this
    // file: every successful transition writes one audit row.
    // Comment out the audit insert in transitionTenantStatus and
    // the "active → suspended: with reason" assertion turns red
    // on the audit-row expectation. No new machinery needed — this
    // is the per-review-checklist §6 mutation proof.
    const tenantId = await seedTenant("active");
    await transitionTenantStatus(
      tenantId,
      { targetStatus: "suspended", reason: "atomicity probe" },
      { actorId },
    );
    const auditCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from platform_audit_log where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(Number(auditCount.count)).toBe(1);
  });
});
