import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { applyPreset } from "@/db/preset-engine";
import { removeSampleData } from "@/db/preset-sample-data";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";
import { provisionPlatformUser, markTotpEnrolled } from "@/db/platform-auth";

// Phase 2.3 — removeSampleData + removeSampleDataAction tests.
//
// The service is the inverse of the engine's seed step: it deletes
// every is_sample=true row on the tenant in one transaction, with a
// lock that refuses if a real (non-sample) program or batch exists.
// The "anything real attaches" rule from the work-guide is
// enforced by the service's lock check; the UI hides the button
// when the lock would fire. Together they implement the work-guide
// item.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
let actorIdValue = "";

beforeAll(async () => {
  const email = `phase23-${uuidv7()}@platform.test`;
  const password = `pw-phase23-${uuidv7()}`;
  const user = await provisionPlatformUser({
    email,
    name: "Phase 2.3 Test",
    password,
    role: "admin",
  });
  await markTotpEnrolled(user.id);
  actorIdValue = user.id;
});

afterAll(async () => {
  await admin.query("delete from platform_sessions where user_id = $1::uuid", [
    actorIdValue,
  ]);
  await admin.query("delete from platform_users where id = $1::uuid", [
    actorIdValue,
  ]);
  await admin.end();
});

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieJar.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (arg: { name: string; value: string }) => {
      cookieJar.set(arg.name, arg.value);
    },
  }),
}));

async function loginActor(): Promise<void> {
  const sessionId = uuidv7();
  const token = uuidv7() + uuidv7().replace(/-/g, "");
  const tokenHash = createHmac("sha256", "platform-session-token-v1")
    .update(token)
    .digest("hex");
  await admin.query(
    `insert into platform_sessions
       (id, user_id, token_hash, second_factor_passed, expires_at)
     values ($1::uuid, $2::uuid, $3, true, now() + interval '1 hour')`,
    [sessionId, actorIdValue, tokenHash],
  );
  cookieJar.set("platform_session", token);
}

async function seedTenantWithSampleData(): Promise<string> {
  const id = uuidv7();
  const slug = `phase23-${id}`;
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'Phase 2.3 Test', 'trial')`,
    [id, slug],
  );
  // Apply the swimming preset so we have seeded data to remove.
  const result = await applyPreset(
    id as never,
    "swimming",
    { actorId: actorIdValue as never },
  );
  if (result.kind !== "ok") {
    throw new Error(
      `setup: applyPreset returned ${result.kind} ${"message" in result ? result.message : ""}`,
    );
  }
  return id;
}

async function cleanupTenant(id: string): Promise<void> {
  await admin.query("delete from platform_audit_log where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenant_features where tenant_id = $1::uuid", [id]);
  await admin.query("delete from role_permissions where tenant_id = $1::uuid", [id]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [id]);
  await admin.query("delete from message_templates where tenant_id = $1::uuid", [id]);
  await admin.query("delete from facility_sub_units where tenant_id = $1::uuid", [id]);
  await admin.query("delete from facilities where tenant_id = $1::uuid", [id]);
  await admin.query("delete from plan_shapes where tenant_id = $1::uuid", [id]);
  await admin.query("delete from skills where tenant_id = $1::uuid", [id]);
  await admin.query("delete from skill_levels where tenant_id = $1::uuid", [id]);
  // E1 — applyPreset now materialises sessions for example batches
  // in the same transaction; clear those before batches (FK).
  await admin.query("delete from sessions where tenant_id = $1::uuid", [id]);
  await admin.query("delete from batches where tenant_id = $1::uuid", [id]);
  await admin.query("delete from programs where tenant_id = $1::uuid", [id]);
  await admin.query("delete from members where tenant_id = $1::uuid", [id]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [id]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenants where id = $1::uuid", [id]);
}

describe("removeSampleData (service)", () => {
  it("happy path: deletes every seeded sample row in one transaction", async () => {
    const tenantId = await seedTenantWithSampleData();
    try {
      // Pre-check: seeded rows exist
      const programsBefore = await admin.query<{ count: string }>(
        "select count(*)::text from programs where tenant_id = $1::uuid and is_sample = true and deleted_at is null",
        [tenantId],
      );
      expect(Number(programsBefore.rows[0]?.count)).toBeGreaterThan(0);

      const result = await removeSampleData(tenantId as never, {
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.counts.programs).toBeGreaterThan(0);
      expect(result.counts.batches).toBeGreaterThan(0);
      expect(result.counts.facilities).toBeGreaterThan(0);
      expect(result.counts.planShapes).toBeGreaterThan(0);
      expect(result.counts.messageTemplates).toBeGreaterThan(0);

      // Post-check: every sample row is gone (none left with
      // deleted_at is null AND is_sample = true).
      const stillSample = await admin.query<{ count: string }>(
        `select count(*)::text from programs
         where tenant_id = $1::uuid and is_sample = true and deleted_at is null`,
        [tenantId],
      );
      expect(Number(stillSample.rows[0]?.count)).toBe(0);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("refuses when a real (non-sample) program exists", async () => {
    const tenantId = await seedTenantWithSampleData();
    try {
      // Add a real program alongside the sample.
      const realProgramId = uuidv7();
      await admin.query(
        `insert into programs (id, tenant_id, name, is_sample, created_by)
         values ($1, $2, $3, false, $4)`,
        [realProgramId, tenantId, "Real program", actorIdValue],
      );

      const result = await removeSampleData(tenantId as never, {
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("lock_active");
      if (result.kind !== "lock_active") return;
      expect(result.reason).toBe("real_row_exists");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("writes a platform_audit_log row recording the action", async () => {
    const tenantId = await seedTenantWithSampleData();
    try {
      await removeSampleData(tenantId as never, {
        actorId: actorIdValue as never,
      });
      const audit = (
        await admin.query<{
          action: string;
          detail: Record<string, unknown>;
        }>(
          `select action, detail from platform_audit_log
           where tenant_id = $1::uuid
             and action = 'tenant.remove_sample_data'`,
          [tenantId],
        )
      ).rows[0]!;
      expect(audit.action).toBe("tenant.remove_sample_data");
      const counts = audit.detail.counts as Record<string, number>;
      expect(counts.programs).toBeGreaterThan(0);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("returns tenant_not_found for an unknown tenant id", async () => {
    const result = await removeSampleData(
      "00000000-0000-4000-8000-000000000000" as never,
      { actorId: actorIdValue as never },
    );
    expect(result.kind).toBe("tenant_not_found");
  });
});

describe("removeSampleDataAction (server action)", () => {
  it("returns invalid when the input shape is bad", async () => {
    await loginActor();
    const result = await removeSampleDataAction({
      tenantId: "not-a-uuid",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("returns invalid when the cookie is missing", async () => {
    cookieJar.delete("platform_session");
    const result = await removeSampleDataAction({
      tenantId: uuidv7(),
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("happy path: removes seeded sample data and returns ok", async () => {
    await loginActor();
    const tenantId = await seedTenantWithSampleData();
    try {
      const result = await removeSampleDataAction({ tenantId });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.counts.programs).toBeGreaterThan(0);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("returns lock_active when a real program exists", async () => {
    await loginActor();
    const tenantId = await seedTenantWithSampleData();
    try {
      const realProgramId = uuidv7();
      await admin.query(
        `insert into programs (id, tenant_id, name, is_sample, created_by)
         values ($1, $2, $3, false, $4)`,
        [realProgramId, tenantId, "Real program", actorIdValue],
      );
      const result = await removeSampleDataAction({ tenantId });
      expect(result.kind).toBe("lock_active");
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
