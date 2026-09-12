// @vitest-environment node
//
// Slice 4 — owner-only reset links.
//
// Reset is the ops-issued path for an owner who forgot their PIN:
//   - issued only for a membership whose role key is 'owner' AND
//     status is 'active' (an invited owner uses the invite flow);
//   - purpose 'reset', 1-hour TTL (RESET_LINK_TTL_SECONDS);
//   - preview always leads to the set-PIN screen (even though a
//     credential exists);
//   - redeem overwrites the credential, revokes the owner's other
//     sessions, and mints a fresh one;
//   - the owner check is re-run at redeem (defense in depth against a
//     hand-signed token bypassing the issuance guard);
//   - single-use like every other link.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import {
  issueOwnerResetLink,
  issueOwnerResetLinkForPhone,
} from "@/lib/services/invite-link-issue";
import {
  previewLoginLink,
  redeemLoginLink,
} from "@/lib/services/invite-link";
import { signInviteLinkToken } from "@/lib/services/invite-link-token";
import { RESET_LINK_TTL_SECONDS } from "@/lib/services/invite-link-token";
import { pinLogin, setCredential } from "@/lib/services/credentials";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91989${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let ownerMembershipId = "";
let coachMembershipId = "";
let invitedOwnerMembershipId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Reset Link Test', $3, 'Asia/Kolkata')",
    [tenantId, `reset-link-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);

  const roleId = async (key: string): Promise<string> => {
    const r = await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1::uuid and key = $2",
      [tenantId, key],
    );
    if (!r.rows[0]?.id) throw new Error(`no role ${key}`);
    return r.rows[0].id;
  };

  const mkMembership = async (
    key: string,
    p: string,
    status: "active" | "invited",
  ): Promise<{ membershipId: string; userId: UserId }> => {
    const userId = asUserId(uuidv7());
    await withPlatform(async () => {
      await db.insert(users).values({ id: userId, phone: p });
    });
    const membershipId = uuidv7();
    await admin.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values ($1, $2::uuid, $3, $4, $5)`,
      [membershipId, tenantId, userId, await roleId(key), status],
    );
    return { membershipId, userId };
  };

  ownerMembershipId = (await mkMembership("owner", phone("01"), "active")).membershipId;
  coachMembershipId = (await mkMembership("coach", phone("02"), "active")).membershipId;
  invitedOwnerMembershipId = (await mkMembership("owner", phone("03"), "invited")).membershipId;
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from invite_link_uses where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  for (const suffix of ["01", "02", "03"]) {
    const p = phone(suffix);
    await admin.query(
      "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
      [p],
    );
    await admin.query(
      "delete from ba_account where user_id in (select id from ba_user where phone_number = $1)",
      [p],
    );
    await admin.query("delete from ba_user where phone_number = $1", [p]);
    await admin.query("delete from users where phone = $1", [p]);
  }
  await admin.end();
});

async function ownerBaId(): Promise<string> {
  const r = await admin.query<{ id: string }>(
    "select id from ba_user where phone_number = $1",
    [phone("01")],
  );
  if (r.rows[0]?.id) return r.rows[0].id;
  const baId = uuidv7();
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: baId,
      name: phone("01"),
      email: `${phone("01")}@phone.aqua.local`,
      phoneNumber: phone("01"),
      phoneNumberVerified: true,
    });
  });
  return baId;
}

describe("issuance is owner-only and active-only", () => {
  it("refuses a non-owner membership with not_owner", async () => {
    const r = await issueOwnerResetLink(tenantId, coachMembershipId);
    expect(r).toMatchObject({ kind: "error", code: "not_owner" });
  });

  it("refuses an invited owner with not_active (invite flow covers first set)", async () => {
    const r = await issueOwnerResetLink(tenantId, invitedOwnerMembershipId);
    expect(r).toMatchObject({ kind: "error", code: "not_active" });
  });

  it("issues a reset link for an active owner with the 1-hour TTL", async () => {
    const r = await issueOwnerResetLink(tenantId, ownerMembershipId);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.purpose).toBe("reset");
    expect(r.urlPath.startsWith("/login/link/")).toBe(true);
    const ttlMs = r.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan((RESET_LINK_TTL_SECONDS - 60) * 1000);
    expect(ttlMs).toBeLessThanOrEqual(RESET_LINK_TTL_SECONDS * 1000);
  });

  it("phone-keyed issuance refuses unknown phones, non-owners, and accepts the owner", async () => {
    const unknown = await issueOwnerResetLinkForPhone(tenantId, phone("99"));
    expect(unknown).toMatchObject({ kind: "error", code: "membership_not_found" });

    const coach = await issueOwnerResetLinkForPhone(tenantId, phone("02"));
    expect(coach).toMatchObject({ kind: "error", code: "not_owner" });

    const owner = await issueOwnerResetLinkForPhone(tenantId, phone("01"));
    expect(owner.kind).toBe("ok");
    if (owner.kind !== "ok") return;
    expect(owner.purpose).toBe("reset");
  });
});

describe("preview and redeem of a reset link", () => {
  it("preview reports purpose reset and credentialSet true, and consumes nothing", async () => {
    const baId = await ownerBaId();
    await setCredential(baId, "111111");
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");

    const preview = await previewLoginLink(issued.token);
    expect(preview.kind).toBe("ok");
    if (preview.kind !== "ok") return;
    expect(preview.purpose).toBe("reset");
    expect(preview.credentialSet).toBe(true);

    // Nothing consumed: the token still redeems below.
    const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(redeemed.kind).toBe("ok");
  });

  it("redeem overwrites the PIN: the old one stops working, the new one signs in", async () => {
    const baId = await ownerBaId();
    await setCredential(baId, "111111");
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");

    const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(redeemed.kind).toBe("ok");

    const oldPin = await pinLogin(phone("01"), "111111");
    expect(oldPin.status).toBeGreaterThanOrEqual(400);
    const newPin = await pinLogin(phone("01"), "999999");
    expect(newPin.status).toBe(200);
  });

  it("redeem revokes the owner's other sessions and mints a fresh one", async () => {
    const baId = await ownerBaId();
    await setCredential(baId, "111111");
    // Plant a pre-existing session (as if the owner were signed in on
    // another device before the reset).
    const oldToken = `old-session-${RUN}`;
    await admin.query(
      `insert into ba_session (id, user_id, token, expires_at, created_at, updated_at)
       values ($1, $2, $3, now() + interval '7 days', now(), now())`,
      [uuidv7(), baId, oldToken],
    );
    expect(
      (
        await admin.query("select 1 from ba_session where token = $1", [oldToken])
      ).rows,
    ).toHaveLength(1);

    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(redeemed.kind).toBe("ok");
    if (redeemed.kind !== "ok") return;

    const gone = await admin.query("select 1 from ba_session where token = $1", [oldToken]);
    expect(gone.rows).toHaveLength(0);
    const fresh = await admin.query("select 1 from ba_session where token = $1", [
      (redeemed as { sessionToken: string }).sessionToken,
    ]);
    expect(fresh.rows).toHaveLength(1);
  });

  it("a hand-signed reset token for a non-owner is rejected at redeem with not_owner and not consumed", async () => {
    const forged = signInviteLinkToken({
      tenantId,
      membershipId: coachMembershipId,
      purpose: "reset",
    });
    const redeemed = await redeemLoginLink(forged.token, { pin: "999999" });
    expect(redeemed).toMatchObject({ kind: "error", code: "not_owner" });
    const used = await admin.query("select 1 from invite_link_uses where jti = $1", [
      forged.claims.jti,
    ]);
    expect(used.rows).toHaveLength(0);
  });

  it("a reset link is single-use", async () => {
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const first = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(first.kind).toBe("ok");
    const second = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(second).toMatchObject({ kind: "error", code: "used" });
  });
});
