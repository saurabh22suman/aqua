import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { inviteOwner } from "@/db/tenant-invite";
import { activateInvitedMemberships } from "@/db/membership-activation";
import { asUserId } from "@/lib/ids";

// D1 — proves invited -> active actually happens, and only for the
// membership the caller was invited to. Mirrors
// invite-owner-action.test.ts's fixture shape (seedTenantWithOwnerRole
// inserts the owner role directly since seedRoleTemplates doesn't run
// from a test harness).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = uuidv7();
let actorIdValue = "";

async function actor(): Promise<string> {
  if (actorIdValue) return actorIdValue;
  const id = uuidv7();
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Membership Activation Test', 'h', 's', 'admin', 'active')`,
    [id, `membership-activation-${RUN}@platform.test`],
  );
  actorIdValue = id;
  return id;
}

afterAll(async () => {
  if (actorIdValue) {
    await admin.query("delete from platform_users where id = $1::uuid", [actorIdValue]);
  }
  await admin.end();
});

async function seedTenantWithOwnerRole(label: string): Promise<string> {
  const id = uuidv7();
  const slug = `membership-activation-${RUN}-${label}`;
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'Activation Test', 'trial')`,
    [id, slug],
  );
  const roleId = uuidv7();
  await admin.query(
    `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal, created_by)
     values ($1, $2, 'owner', 'Owner', true, '/owner', 0, $3)`,
    [roleId, id, await actor()],
  );
  return id;
}

async function cleanupTenant(id: string): Promise<void> {
  await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [id]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [id]);
  await admin.query("delete from tenants where id = $1::uuid", [id]);
}

async function membershipStatus(tenantId: string, userId: string): Promise<string | undefined> {
  const rows = await admin.query<{ status: string }>(
    `select status from tenant_memberships where tenant_id = $1 and user_id = $2`,
    [tenantId, userId],
  );
  return rows.rows[0]?.status;
}

describe("activateInvitedMemberships", () => {
  it("flips an invited membership to active", async () => {
    const tenantId = await seedTenantWithOwnerRole("happy");
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const invited = await inviteOwner(tenantId as never, { phone, actorId: asUserId(await actor()) });
      expect(invited.kind).toBe("ok");
      if (invited.kind !== "ok") return;

      expect(await membershipStatus(tenantId, invited.userId)).toBe("invited");

      await activateInvitedMemberships(asUserId(invited.userId));

      expect(await membershipStatus(tenantId, invited.userId)).toBe("active");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("is a no-op for a user with no invitation anywhere", async () => {
    const fakeUserId = uuidv7();
    // No users row, no tenant_memberships row — must not throw, must
    // not create anything.
    await expect(activateInvitedMemberships(asUserId(fakeUserId))).resolves.toBeUndefined();
    const rows = await admin.query(
      "select 1 from tenant_memberships where user_id = $1::uuid",
      [fakeUserId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it("does not reactivate a revoked membership", async () => {
    const tenantId = await seedTenantWithOwnerRole("revoked");
    try {
      const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const invited = await inviteOwner(tenantId as never, { phone, actorId: asUserId(await actor()) });
      expect(invited.kind).toBe("ok");
      if (invited.kind !== "ok") return;

      await admin.query(
        "update tenant_memberships set status = 'revoked' where tenant_id = $1 and user_id = $2",
        [tenantId, invited.userId],
      );

      await activateInvitedMemberships(asUserId(invited.userId));

      expect(await membershipStatus(tenantId, invited.userId)).toBe("revoked");
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  it("activating one user never touches another user's invited membership in a different tenant", async () => {
    const tenantA = await seedTenantWithOwnerRole("cross-a");
    const tenantB = await seedTenantWithOwnerRole("cross-b");
    try {
      const phoneA = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const phoneB = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
      const invitedA = await inviteOwner(tenantA as never, { phone: phoneA, actorId: asUserId(await actor()) });
      const invitedB = await inviteOwner(tenantB as never, { phone: phoneB, actorId: asUserId(await actor()) });
      expect(invitedA.kind).toBe("ok");
      expect(invitedB.kind).toBe("ok");
      if (invitedA.kind !== "ok" || invitedB.kind !== "ok") return;

      await activateInvitedMemberships(asUserId(invitedA.userId));

      expect(await membershipStatus(tenantA, invitedA.userId)).toBe("active");
      // B was never OTP-verified — still invited, untouched by A's activation.
      expect(await membershipStatus(tenantB, invitedB.userId)).toBe("invited");
    } finally {
      await cleanupTenant(tenantA);
      await cleanupTenant(tenantB);
    }
  });
});
