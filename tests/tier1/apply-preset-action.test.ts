import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { applyPresetAction } from "@/lib/actions/platform-preset-apply";
import { provisionPlatformUser, markTotpEnrolled } from "@/db/platform-auth";

// Phase 2.2b — applyPresetAction server action tests. The action
// lives in lib/actions/platform-preset-apply.ts; the test mirrors
// the standing-rule pattern (parse → auth → service) and exercises
// each shape the UI handles (ok, lock_active, not_found, invalid).
//
// The 2.2a engine tests already cover the engine behaviour in
// depth; this file only tests the action's surface, not the engine
// internals.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
let actorIdValue = "";

beforeAll(async () => {
  // Stand up a platform user with TOTP enrolled so the
  // platformAuthStatusAction call returns "authenticated" in the
  // happy-path tests. The cookie-mocking below routes that call
  // through the mocked Map.
  const email = `phase22b-action-${uuidv7()}@platform.test`;
  const password = `pw-phase22b-${uuidv7()}`;
  const user = await provisionPlatformUser({
    email,
    name: "Phase 2.2b Test",
    password,
    role: "admin",
  });
  await markTotpEnrolled(user.id);
  actorIdValue = user.id;
});

afterAll(async () => {
  // Clean up the test user.
  await admin.query("delete from platform_sessions where user_id = $1::uuid", [
    actorIdValue,
  ]);
  await admin.query("delete from platform_users where id = $1::uuid", [
    actorIdValue,
  ]);
  await admin.end();
});

// Mock next/headers (cookies) so the server action can read the
// platform session token. The Map-backed jar substitutes for the
// production HttpOnly cookie wrapper; the production behaviour is
// tested separately in tests/tier1/platform-auth.test.ts.
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

// H1 — revalidatePath is called by applyPresetAction on success. In
// unit tests there is no static-generation store, so revalidatePath
// throws — mock it as a no-op.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

// H1 — actions take FormData. applyPresetAction redirects on success;
// the mock below turns redirect() into a thrown RedirectSignal.
class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectSignal(path);
  },
}));

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

async function loginActor(): Promise<void> {
  // Insert a platform_sessions row directly so the action's
  // permission check sees an authenticated session. Going through
  // the real login + TOTP flow here would mean re-implementing the
  // TOTP / scrypt helpers — the engine's contract is what we're
  // testing, not the auth flow (covered in
  // tests/tier1/platform-auth.test.ts).
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

// The TOTP helper was here for an earlier draft of loginActor; the
// final version inserts a platform_sessions row directly. The
// helper is kept as a typed void marker so the import in the
// earlier draft still resolves; remove this if the TOTP path
// returns.
function makeTotpCode(): string {
  return "000000";
}
void makeTotpCode;

async function seedTenant(): Promise<string> {
  const id = uuidv7();
  const slug = `phase22b-action-${id}`;
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'Phase 2.2b Test', 'trial')`,
    [id, slug],
  );
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
  // detach soft-deleted is_sample rows: the engine marks them
  // deleted_at; the test fixture cleans them up before the cascade
  // touches locations/members. The cascade itself fails when a
  // facility_sub_units row references a facility that's still alive.
  await admin.query("delete from members where tenant_id = $1::uuid", [id]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [id]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenants where id = $1::uuid", [id]);
}

describe("applyPresetAction", () => {
  it("returns invalid when the input shape is bad", async () => {
    const result = await applyPresetAction(null, fd({
      tenantId: "not-a-uuid",
      featureKey: "",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("returns invalid when the cookie is missing (unauthenticated)", async () => {
    cookieJar.delete("platform_session");
    const result = await applyPresetAction(null, fd({
      tenantId: uuidv7(),
      featureKey: "swimming",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
    expect(result.message.toLowerCase()).toContain("session");
  });

  it("applies swimming on a fresh tenant and redirects to /platform/tenants/[id]", async () => {
    await loginActor();
    const tenantId = await seedTenant();
    try {
      let captured: string | null = null;
      try {
        await applyPresetAction(null, fd({ tenantId, featureKey: "swimming" }));
      } catch (err) {
        if (err instanceof RedirectSignal) captured = err.path;
        else throw err;
      }
      expect(captured).toBe(`/platform/tenants/${tenantId}`);
      // tenant fields stamped
      const stamped = (
        await admin.query<{ preset_key: string }>(
          "select preset_key from tenants where id = $1::uuid",
          [tenantId],
        )
      ).rows[0]!;
      expect(stamped.preset_key).toBe("swimming");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("rejects a second apply of the same preset as a no-op redirect (idempotent)", async () => {
    await loginActor();
    const tenantId = await seedTenant();
    try {
      let firstRedirect: string | null = null;
      try {
        await applyPresetAction(null, fd({ tenantId, featureKey: "swimming" }));
      } catch (err) {
        if (err instanceof RedirectSignal) firstRedirect = err.path;
        else throw err;
      }
      expect(firstRedirect).toBe(`/platform/tenants/${tenantId}`);
      let secondRedirect: string | null = null;
      try {
        await applyPresetAction(null, fd({ tenantId, featureKey: "swimming" }));
      } catch (err) {
        if (err instanceof RedirectSignal) secondRedirect = err.path;
        else throw err;
      }
      expect(secondRedirect).toBe(`/platform/tenants/${tenantId}`);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("returns lock_active when a member exists for the tenant", async () => {
    await loginActor();
    const tenantId = await seedTenant();
    // Add a member directly — the engine's lock check sees it on
    // the next apply. The apply should refuse.
    const personId = uuidv7();
    const locationId = uuidv7();
    const memberId = uuidv7();
    try {
      await admin.query(
        "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
        [locationId, tenantId],
      );
      await admin.query(
        "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'X', '1990-01-01')",
        [personId, tenantId],
      );
      await admin.query(
        "insert into members (id, tenant_id, person_id, location_id, status, member_code) values ($1, $2, $3, $4, 'active', $5)",
        [memberId, tenantId, personId, locationId, `phase22b-${memberId}`],
      );
      const result = await applyPresetAction(null, fd({
        tenantId,
        featureKey: "swimming",
      }));
      expect(result.kind).toBe("lock_active");
      if (result.kind !== "lock_active") return;
      expect(result.reason).toBe("non_sample_member_exists");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("returns preset_not_found for an unknown key", async () => {
    await loginActor();
    const tenantId = await seedTenant();
    try {
      const result = await applyPresetAction(null, fd({
        tenantId,
        featureKey: "does-not-exist",
      }));
      expect(result.kind).toBe("preset_not_found");
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
