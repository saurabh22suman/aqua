import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";

// Slice 2b — invite_link_uses reset purpose.
//
// The CHECK constraint invite_link_uses_purpose_check currently
// accepts only 'invite' and 'relogin'. The 2026-09-11 auth feature
// adds 'reset': ops-issued, owner-only, 1-hour-TTL link whose
// redeem path forces the set-PIN screen even though a credential
// exists (overwrites the PIN). invite and relogin are unchanged.
//
// Forward-only: drop and re-add the constraint, widening the
// allowed set. No data backfill — existing rows stay untouched.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

// One tenant + owner membership, shared across all five tests.
// Each test inserts a fresh invite_link_uses row (unique jti) and
// asserts on the constraint's accept-or-reject behaviour.
let tenantId = "";
let membershipId = "";

beforeAll(async () => {
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  tenantId = uuidv7();
  await admin.query(
    `insert into tenants (id, slug, name, plan_id, timezone)
     values ($1, $2, 'Reset Purpose Test', $3, 'Asia/Kolkata')`,
    [tenantId, `reset-purpose-${RUN}`, plan?.id ?? null],
  );
  const userId = uuidv7();
  await admin.query(
    "insert into users (id, phone) values ($1, $2)",
    [userId, `+91rpu${userId.replace(/-/g, "").slice(0, 8)}`],
  );
  // Roles must be seeded before memberships reference them — same
  // sequence createTenant() runs (lib/services/roles.ts + tenant-invite.ts).
  // seedRoleTemplates runs as the privileged role (withPlatform
  // would refuse; admin pool is fine).
  await seedRoleTemplates(asTenantId(tenantId));
  const seededOwner = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1::uuid and key = 'owner'",
      [tenantId],
    )
  ).rows[0];
  if (!seededOwner) throw new Error("test setup: seedRoleTemplates did not create owner role");
  membershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [membershipId, tenantId, userId, seededOwner.id],
  );
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from invite_link_uses where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from users where phone like '+91rpu%'");
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("invite-link reset purpose migration: 20260912000100_invite_link_reset_purpose.sql", () => {
  it("exists, drops the old CHECK constraint, and re-adds it with reset accepted", () => {
    const sql = readFileSync(
      "db/migrations/20260912000100_invite_link_reset_purpose.sql",
      "utf8",
    );
    expect(sql).toMatch(/invite_link_uses_purpose_check/i);
    expect(sql).toMatch(/drop\s+constraint/i);
    expect(sql).toMatch(/add\s+constraint/i);
    expect(sql).toMatch(/invite/i);
    expect(sql).toMatch(/relogin/i);
    expect(sql).toMatch(/reset/i);
  });

  it("accepts 'invite' (regression — old behaviour still works)", async () => {
    await expect(
      admin.query(
        `insert into invite_link_uses (jti, tenant_id, membership_id, purpose)
         values ($1, $2::uuid, $3::uuid, 'invite')`,
        [uuidv7(), tenantId, membershipId],
      ),
    ).resolves.toBeDefined();
  });

  it("accepts 'relogin' (regression — old behaviour still works)", async () => {
    await expect(
      admin.query(
        `insert into invite_link_uses (jti, tenant_id, membership_id, purpose)
         values ($1, $2::uuid, $3::uuid, 'relogin')`,
        [uuidv7(), tenantId, membershipId],
      ),
    ).resolves.toBeDefined();
  });

  it("accepts 'reset' (the new behaviour)", async () => {
    await expect(
      admin.query(
        `insert into invite_link_uses (jti, tenant_id, membership_id, purpose)
         values ($1, $2::uuid, $3::uuid, 'reset')`,
        [uuidv7(), tenantId, membershipId],
      ),
    ).resolves.toBeDefined();
  });

  it("still rejects a garbage purpose (CHECK constraint is a closed list, not open)", async () => {
    await expect(
      admin.query(
        `insert into invite_link_uses (jti, tenant_id, membership_id, purpose)
         values ($1, $2::uuid, $3::uuid, 'garbage')`,
        [uuidv7(), tenantId, membershipId],
      ),
    ).rejects.toThrow(/invite_link_uses_purpose_check|check constraint/i);
  });
});
