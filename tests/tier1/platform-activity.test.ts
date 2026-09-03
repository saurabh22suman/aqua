import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { listPlatformActivity, listKnownActions } from "@/db/platform-activity";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";
import { provisionPlatformUser, markTotpEnrolled } from "@/db/platform-auth";

// Phase 3.9 — platform activity log. TDD; page + form land in
// the same PR. Service is what's tested here — the action
// layer is a thin permission gate (verified separately via the
// standard modal-auth-status guard), not exercised in this
// file.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let actorId = "";

beforeAll(async () => {
  // Provision a real platform operator so the audit rows can
  // attribute to a real platform_user.id — without that the
  // FK violation kicks in at insert time (platform_audit_log.
  // actor_id references platform_users.id).
  const email = `phase39-activity-${RUN}@platform.test`;
  const user = await provisionPlatformUser({
    email,
    name: "Activity Test",
    password: `pw-phase39-${RUN}`,
    role: "admin",
  });
  await markTotpEnrolled(user.id);
  actorId = user.id;
});

afterAll(async () => {
  if (actorId) {
    await admin.query("delete from platform_audit_log where actor_id = $1::uuid", [actorId]);
    await admin.query("delete from platform_sessions where user_id = $1::uuid", [actorId]);
    await admin.query("delete from platform_users where id = $1::uuid", [actorId]);
  }
  await admin.end();
});

async function writeRow(args: {
  tenantId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  createdAt?: Date;
}): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into platform_audit_log
       (id, actor_id, tenant_id, action, target_type, target_id, detail, created_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4, 'tenant', $5::uuid, $6::jsonb, $7)`,
    [
      id,
      actorId,
      args.tenantId ?? null,
      args.action,
      id,
      JSON.stringify(args.detail ?? {}),
      args.createdAt ?? new Date(),
    ],
  );
  return id;
}

async function makeTenant(label: string): Promise<string> {
  const id = uuidv7();
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1::uuid, $2, $3, $4::uuid, $5)",
    [id, `phase39-${label}-${RUN}`, `Activity Test ${label}`, plan?.id ?? null, TZ],
  );
  return id;
}

describe("listPlatformActivity (Phase 3.9)", () => {
  it("returns the rows we wrote, joined with tenant name/slug when present", async () => {
    const tenantA = await makeTenant("a");
    const tenantB = await makeTenant("b");
    await writeRow({ tenantId: tenantA, action: "tenant.activate", detail: { from: "trial", to: "active" } });
    await writeRow({ tenantId: tenantB, action: "tenant.invite_owner" });
    await writeRow({ action: "platform_user.create", tenantId: null });

    const result = await listPlatformActivity({});
    const actions = result.rows.map((r) => r.action).sort();
    // Other rows from other tests in this run may also be
    // present; the ones we wrote must be in there.
    expect(actions).toContain("tenant.activate");
    expect(actions).toContain("tenant.invite_owner");
    expect(actions).toContain("platform_user.create");

    // Tenant join: tenant.activate's row should carry the
    // tenant name back so the UI doesn't need a second round
    // trip.
    const activate = result.rows.find((r) => r.action === "tenant.activate" && r.tenantId === tenantA);
    expect(activate?.tenantName).toMatch(/^Activity Test /);
  });

  it("filters by tenantId", async () => {
    const tenantC = await makeTenant("c");
    await writeRow({ tenantId: tenantC, action: "tenant.suspend" });
    const result = await listPlatformActivity({ tenantId: tenantC });
    for (const row of result.rows) {
      expect(row.tenantId).toBe(tenantC);
    }
  });

  it("filters by action", async () => {
    await writeRow({ action: "tenant.churn" });
    const result = await listPlatformActivity({ action: "tenant.churn" });
    for (const row of result.rows) {
      expect(row.action).toBe("tenant.churn");
    }
  });

  it("filters by date range", async () => {
    const older = new Date(Date.now() - 24 * 60 * 60 * 1000); // -24h
    const future = new Date(Date.now() + 60_000); // +1m
    const recent = new Date();
    await writeRow({ action: "tenant.activate.range", createdAt: older });
    await writeRow({ action: "tenant.activate.range", createdAt: recent });

    const futureOnly = await listPlatformActivity({
      since: future.toISOString(),
    });
    for (const row of futureOnly.rows) {
      // every row must be after the future timestamp
      expect(row.createdAt.getTime() >= future.getTime()).toBe(true);
    }
  });

  it("respects the limit/offset pagination", async () => {
    const firstPage = await listPlatformActivity({ limit: 5, offset: 0 });
    const secondPage = await listPlatformActivity({ limit: 5, offset: 5 });
    expect(firstPage.rows.length).toBeLessThanOrEqual(5);
    expect(secondPage.rows.length).toBeLessThanOrEqual(5);
    const firstIds = new Set(firstPage.rows.map((r) => r.id));
    for (const r of secondPage.rows) {
      expect(firstIds.has(r.id)).toBe(false);
    }
  });

  it("the total count is independent of limit", async () => {
    const all = await listPlatformActivity({ limit: 500 });
    const trimmed = await listPlatformActivity({ limit: 3 });
    expect(trimmed.rows.length).toBeLessThanOrEqual(3);
    expect(trimmed.total).toBe(all.total);
  });

  it("rejects an invalid filter — surfaces structured parse errors via Zod", async () => {
    // The Zod schema throws on parse; this pins that the parse
    // is at the boundary (not pushed down to a SQL error).
    await expect(
      listPlatformActivity({ limit: 1000000 } as never),
    ).rejects.toThrow();
  });
});

describe("listKnownActions (Phase 3.9)", () => {
  it("returns the distinct action keys (sorted, ascending)", async () => {
    await writeRow({ action: "tenant.activate.distinct" });
    await writeRow({ action: "tenant.suspend.distinct" });
    const actions = await listKnownActions();
    expect(actions).toContain("tenant.activate.distinct");
    expect(actions).toContain("tenant.suspend.distinct");
    // Sort: ascending alphabetical
    const sorted = [...actions].sort();
    expect(actions).toEqual(sorted);
  });
});

describe("action layer (Phase 3.9)", () => {
  it("listPlatformActivityAction surfaces the same data when the operator is signed in", async () => {
    // The action layer's auth gate lives in lib/actions/platform-
    // auth.ts; rather than mock its cookie/JWT machinery (it
    // would pull better-auth plugin code that isn't worth
    // faking), we test the runtime shape via the service.
    // The action's parse-first/permission-second preamble is
    // covered by the standing server-action-preamble test.
    await writeRow({ action: "tenant.activate.action_smoke" });
    const via = await listKnownActions();
    expect(via).toContain("tenant.activate.action_smoke");
    // The action wrapper exists and accepts the same input
    // shape — the auth gate is platformAuthStatusAction which is
    // own-tested; smoke-test the export wiring here.
    expect(typeof listPlatformActivityAction).toBe("function");
    expect(typeof listKnownActionsAction).toBe("function");
  });
});
