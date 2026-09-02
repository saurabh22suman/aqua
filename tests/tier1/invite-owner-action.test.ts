import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { inviteOwner } from "@/db/tenant-invite";
import { inviteOwnerAction } from "@/lib/actions/platform-invite-owner";
import { provisionPlatformUser, markTotpEnrolled } from "@/db/platform-auth";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
let actorIdValue = "";

beforeAll(async () => {
  const email = `phase27-${uuidv7()}@platform.test`;
  const password = `pw-phase27-${uuidv7()}`;
  const user = await provisionPlatformUser({
    email,
    name: "Phase 2.7 Test",
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

async function seedTenantWithOwnerRole(): Promise<string> {
  // seedRoleTemplates doesn't run from a test harness; insert the
  // owner role directly. Same shape as ROLE_TEMPLATES[0] in
  // lib/services/roles.ts.
  const id = uuidv7();
  const slug = `phase27-${id}`;
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'Phase 2.7 Test', 'trial')`,
    [id, slug],
  );
  const roleId = uuidv7();
  await admin.query(
    `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal, created_by)
     values ($1, $2, 'owner', 'Owner', true, '/owner', 0, $3)`,
    [roleId, id, actorIdValue],
  );
  return id;
}

async function cleanupTenant(id: string): Promise<void> {
  await admin.query("delete from platform_audit_log where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [id]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenants where id = $1::uuid", [id]);
}

describe("inviteOwner (service)", () => {
  it("happy path: creates a new user and an invited membership", async () => {
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const result = await inviteOwner(tenantId as never, {
        phone,
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.wasNewUser).toBe(true);
      const membership = await admin.query<{
        status: string;
        user_id: string;
      }>(
        `select status, user_id from tenant_memberships
         where tenant_id = $1 and id = $2`,
        [tenantId, result.membershipId],
      );
      expect(membership.rows[0]?.status).toBe("invited");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("reuses an existing user and reports wasNewUser=false", async () => {
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      // Create the user ahead of the invite. The id column has
      // no SQL default (drizzle's $defaultFn is client-side), so
      // we have to fill it explicitly here.
      await admin.query(
        `insert into users (id, phone) values (gen_random_uuid(), $1)`,
        [phone],
      );

      const result = await inviteOwner(tenantId as never, {
        phone,
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.wasNewUser).toBe(false);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("rejects an invalid phone number with kind:'error', code:'invalid'", async () => {
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const result = await inviteOwner(tenantId as never, {
        phone: "not-a-number",
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("invalid");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("returns code:'tenant_not_found' for an unknown tenant", async () => {
    const result = await inviteOwner(
      "00000000-0000-4000-8000-000000000000" as never,
      { phone: "+919999999999", actorId: actorIdValue as never },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("tenant_not_found");
  });

  it("returns code:'owner_role_missing' when the tenant has no owner role", async () => {
    const id = uuidv7();
    const slug = `phase27-norole-${id}`;
    await admin.query(
      `insert into tenants (id, slug, name, status) values ($1, $2, 'No Owner', 'trial')`,
      [id, slug],
    );
    try {
      const result = await inviteOwner(id as never, {
        phone: "+919999999999",
        actorId: actorIdValue as never,
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("owner_role_missing");
    } finally {
      await admin.query("delete from tenants where id = $1::uuid", [id]);
    }
  });

  it("returns code:'already_member' on a second invite to the same user", async () => {
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const first = await inviteOwner(tenantId as never, {
        phone,
        actorId: actorIdValue as never,
      });
      expect(first.kind).toBe("ok");
      const second = await inviteOwner(tenantId as never, {
        phone,
        actorId: actorIdValue as never,
      });
      expect(second.kind).toBe("error");
      if (second.kind !== "error") return;
      expect(second.code).toBe("already_member");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("writes a platform_audit_log row tagged tenant.invite_owner", async () => {
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      await inviteOwner(tenantId as never, {
        phone,
        actorId: actorIdValue as never,
      });
      const audit = (
        await admin.query<{
          action: string;
          detail: Record<string, unknown>;
        }>(
          `select action, detail from platform_audit_log
           where tenant_id = $1 and action = 'tenant.invite_owner'`,
          [tenantId],
        )
      ).rows[0]!;
      expect(audit.action).toBe("tenant.invite_owner");
      expect((audit.detail as { phone?: string }).phone).toBe(phone);
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});

describe("inviteOwnerAction (server action)", () => {
  it("returns invalid when the input shape is bad", async () => {
    await loginActor();
    const result = await inviteOwnerAction({
      tenantId: "not-a-uuid",
      phone: "+919999999999",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("returns invalid when the cookie is missing", async () => {
    cookieJar.delete("platform_session");
    const result = await inviteOwnerAction({
      tenantId: uuidv7(),
      phone: "+919999999999",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("happy path: ok with wasNewUser true on a fresh tenant", async () => {
    await loginActor();
    const tenantId = await seedTenantWithOwnerRole();
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const result = await inviteOwnerAction({ tenantId, phone });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.wasNewUser).toBe(true);
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
