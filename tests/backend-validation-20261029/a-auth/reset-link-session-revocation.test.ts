// @vitest-environment node
//
// Lane a-auth — reset-link session revocation and reset audit coverage.
//
// The invariant under test is the one the implementation already states,
// not a new requirement:
//
//   lib/services/invite-link.ts
//     "A successful reset revokes the owner's other sessions before the
//      fresh one is minted: the reset may be happening because a device
//      or session was compromised, and leaving those live would defeat
//      the point."
//
//   tests/auth/owner-reset-link.test.ts (header)
//     "redeem overwrites the credential, revokes the owner's other
//      sessions, and mints a fresh one"
//
// The optional PIN is deliberately NOT changed: a reset link may still be
// redeemed without a PIN (the UI always sends one; the API does not
// require one, and no ruling says it should). What is under test is the
// narrower, documented invariant: EVERY successful reset revokes the
// identity's prior sessions.
//
// A reset redemption must also leave a trail. The equivalent WhatsApp
// recovery path writes platform_audit_log 'credentials.pin_reset'
// (db/whatsapp-auth-complete.ts:saveResetPin); the magic-link reset path
// wrote nothing.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own services
// on the app_login runtime connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { issueLoginLink, issueOwnerResetLink } from "@/lib/services/invite-link-issue";
import { redeemLoginLink } from "@/lib/services/invite-link";
import { signInviteLinkToken } from "@/lib/services/invite-link-token";
import { hasCredentialByBaUserId, pinLogin, setCredential } from "@/lib/services/credentials";
import { auth } from "@/lib/auth/server";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91987${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let ownerMembershipId = "";
let ownerUserId: UserId = asUserId("");
let ownerBaId = "";
let coachMembershipId = "";

/** Plant a live session row for a better-auth user (a signed-in device). */
async function plantSession(baUserId: string, label: string): Promise<string> {
  const token = `${label}-${uuidv7()}`;
  await admin.query(
    `insert into ba_session (id, user_id, token, expires_at, created_at, updated_at)
     values ($1, $2, $3, now() + interval '7 days', now(), now())`,
    [uuidv7(), baUserId, token],
  );
  return token;
}

async function sessionCount(baUserId: string): Promise<number> {
  const rows = await admin.query<{ n: number }>(
    "select count(*)::int as n from ba_session where user_id = $1",
    [baUserId],
  );
  return rows.rows[0]?.n ?? 0;
}

async function sessionExists(token: string): Promise<boolean> {
  const rows = await admin.query<{ n: number }>(
    "select count(*)::int as n from ba_session where token = $1",
    [token],
  );
  return (rows.rows[0]?.n ?? 0) > 0;
}

/** Build the cookie better-auth expects for a raw session token. */
async function sessionCookieHeaders(token: string): Promise<Headers> {
  const baCtx = await auth.$context;
  const signature = createHmac("sha256", baCtx.secret).update(token).digest("base64");
  const headers = new Headers();
  headers.set("cookie", `${baCtx.authCookies.sessionToken.name}=${token}.${signature}`);
  return headers;
}

/** Does this session token still authenticate as a live session? */
async function sessionResolves(token: string): Promise<boolean> {
  const headers = await sessionCookieHeaders(token);
  const session = await withPlatform(() => auth.api.getSession({ headers }));
  return !!session?.user;
}


beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth reset test', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-reset-${RUN}`, plan?.id ?? null],
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
  ): Promise<{ membershipId: string; userId: UserId; baId: string }> => {
    const userId = asUserId(uuidv7());
    await withPlatform(async () => {
      await db.insert(users).values({ id: userId, phone: p });
    });
    const baId = uuidv7();
    await withPlatform(async () => {
      await db.insert(baUser).values({
        id: baId,
        name: p,
        email: `${p}@phone.aqua.local`,
        phoneNumber: p,
        phoneNumberVerified: true,
      });
    });
    const membershipId = uuidv7();
    await admin.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values ($1, $2::uuid, $3, $4, $5)`,
      [membershipId, tenantId, userId, await roleId(key), status],
    );
    return { membershipId, userId, baId };
  };

  const owner = await mkMembership("owner", phone("01"), "active");
  ownerMembershipId = owner.membershipId;
  ownerUserId = owner.userId;
  ownerBaId = owner.baId;
  const coach = await mkMembership("coach", phone("02"), "active");
  coachMembershipId = coach.membershipId;
});

afterAll(async () => {
  if (tenantId) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from invite_link_uses where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  for (const suffix of ["01", "02", "03", "04", "05"]) {
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
  await admin.query(
    "delete from platform_audit_log where target_id = $1::uuid or detail->>'membershipId' = $2",
    [ownerUserId, ownerMembershipId],
  );
  await admin.end();
});

describe("a successful reset revokes the owner's prior sessions", () => {
  it("revokes prior sessions when the reset is redeemed WITHOUT a PIN", async () => {
    await setCredential(ownerBaId, "111111");
    const deviceA = await plantSession(ownerBaId, "device-a");
    const deviceB = await plantSession(ownerBaId, "device-b");
    expect(await sessionCount(ownerBaId)).toBe(2);

    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");

    // No PIN supplied — the optional-PIN product behaviour is preserved.
    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");

    // The documented invariant: the prior sessions are gone.
    expect(await sessionExists(deviceA)).toBe(false);
    expect(await sessionExists(deviceB)).toBe(false);
    expect(await sessionCount(ownerBaId)).toBe(1);
  });

  it("keeps the optional-PIN behaviour: without a PIN the credential is not rotated", async () => {
    await setCredential(ownerBaId, "111111");
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");

    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");

    // No PIN was supplied, so no credential rotation happened — the
    // existing PIN still signs in. The PIN requirement is unchanged.
    const oldPin = await pinLogin(phone("01"), "111111");
    expect(oldPin.status).toBe(200);
  });

  it("revokes prior sessions and rotates the credential when a PIN is supplied", async () => {
    await setCredential(ownerBaId, "111111");
    const deviceA = await plantSession(ownerBaId, "device-c");
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");

    const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(redeemed.kind).toBe("ok");

    expect(await sessionExists(deviceA)).toBe(false);
    expect(await sessionCount(ownerBaId)).toBe(1);

    const oldPin = await pinLogin(phone("01"), "111111");
    expect(oldPin.status).toBeGreaterThanOrEqual(400);
    const newPin = await pinLogin(phone("01"), "999999");
    expect(newPin.status).toBe(200);
  });

  it("mints a fresh session that resolves, and the revoked session no longer does", async () => {
    await setCredential(ownerBaId, "111111");
    const stale = await plantSession(ownerBaId, "device-stale");
    expect(await sessionResolves(stale)).toBe(true);

    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");
    const redeemed = await redeemLoginLink(issued.token);
    if (redeemed.kind !== "ok") throw new Error("redeem failed");
    const freshToken = (redeemed as { sessionToken: string }).sessionToken;

    expect(await sessionResolves(stale)).toBe(false);
    expect(await sessionResolves(freshToken)).toBe(true);
  });
});

describe("a redemption that is NOT a reset does not revoke sessions", () => {
  it("an invite redemption leaves the identity's other sessions alone", async () => {
    const invited = await (async () => {
      const userId = asUserId(uuidv7());
      const p = phone("03");
      await withPlatform(async () => {
        await db.insert(users).values({ id: userId, phone: p });
      });
      const baId = uuidv7();
      await withPlatform(async () => {
        await db.insert(baUser).values({
          id: baId,
          name: p,
          email: `${p}@phone.aqua.local`,
          phoneNumber: p,
          phoneNumberVerified: true,
        });
      });
      const roleRow = await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1::uuid and key = 'coach'",
        [tenantId],
      );
      const membershipId = uuidv7();
      await admin.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
         values ($1, $2::uuid, $3, $4, 'invited')`,
        [membershipId, tenantId, userId, roleRow.rows[0]!.id],
      );
      return { membershipId, baId };
    })();

    const device = await plantSession(invited.baId, "invite-device");
    const issued = await issueLoginLink(tenantId, invited.membershipId);
    if (issued.kind !== "ok") throw new Error("setup: invite link was not issued");
    expect(issued.purpose).toBe("invite");

    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
    // An invite is not a reset: the invitee's existing sessions survive.
    expect(await sessionExists(device)).toBe(true);
  });

  it("a relogin redemption leaves the identity's other sessions alone", async () => {
    await setCredential(ownerBaId, "111111");
    const device = await plantSession(ownerBaId, "relogin-device");
    const issued = await issueLoginLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: relogin link was not issued");
    expect(issued.purpose).toBe("relogin");

    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
    expect(await sessionExists(device)).toBe(true);
  });
});

describe("reset link refusals", () => {
  it("a revoked membership's reset link is refused and is not consumed", async () => {
    const revoked = await (async () => {
      const userId = asUserId(uuidv7());
      const p = phone("04");
      await withPlatform(async () => {
        await db.insert(users).values({ id: userId, phone: p });
      });
      const roleRow = await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1::uuid and key = 'owner'",
        [tenantId],
      );
      const membershipId = uuidv7();
      await admin.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
         values ($1, $2::uuid, $3, $4, 'revoked')`,
        [membershipId, tenantId, userId, roleRow.rows[0]!.id],
      );
      return membershipId;
    })();

    const forged = signInviteLinkToken({ tenantId, membershipId: revoked, purpose: "reset" });
    const redeemed = await redeemLoginLink(forged.token);
    expect(redeemed).toMatchObject({ kind: "error", code: "revoked" });
    const used = await admin.query<{ n: number }>(
      "select count(*)::int as n from invite_link_uses where jti = $1",
      [forged.claims.jti],
    );
    expect(used.rows[0]?.n).toBe(0);
  });

  it("a hand-signed reset token for a non-owner is refused with not_owner and is not consumed", async () => {
    const forged = signInviteLinkToken({
      tenantId,
      membershipId: coachMembershipId,
      purpose: "reset",
    });
    const redeemed = await redeemLoginLink(forged.token);
    expect(redeemed).toMatchObject({ kind: "error", code: "not_owner" });
    const used = await admin.query<{ n: number }>(
      "select count(*)::int as n from invite_link_uses where jti = $1",
      [forged.claims.jti],
    );
    expect(used.rows[0]?.n).toBe(0);
  });

  it("an expired reset token is refused", async () => {
    const forged = signInviteLinkToken({
      tenantId,
      membershipId: ownerMembershipId,
      purpose: "reset",
      ttlSeconds: -10,
    });
    const redeemed = await redeemLoginLink(forged.token);
    expect(redeemed).toMatchObject({ kind: "error", code: "invalid" });
  });

  it("a reset link is single-use", async () => {
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");
    const first = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(first.kind).toBe("ok");
    const second = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(second).toMatchObject({ kind: "error", code: "used" });
  });
});

describe("a reset does not hijack another credential row for the same identity", () => {
  // A1 (independent review): better-auth resolves a credential account on
  // FOUR fields — userId, providerId 'credential', the local issuer AND
  // accountId = userId. Its email+password plugin writes accountId = email
  // for the SAME user, so a lookup that omits accountId can land on that
  // row: the reset would overwrite a credential the app's own
  // hasCredentialByBaUserId (four-field) does not see, and the new PIN
  // would not sign in.
  it("leaves a same-user credential row with a different account id alone, and the new PIN still works", async () => {
    const p = phone("05");
    const userId = asUserId(uuidv7());
    await withPlatform(async () => {
      await db.insert(users).values({ id: userId, phone: p });
    });
    const baId = uuidv7();
    await withPlatform(async () => {
      await db.insert(baUser).values({
        id: baId,
        name: p,
        email: `${p}@phone.aqua.local`,
        phoneNumber: p,
        phoneNumberVerified: true,
      });
    });
    const roleRow = await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1::uuid and key = 'owner'",
      [tenantId],
    );
    const membershipId = uuidv7();
    await admin.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values ($1, $2::uuid, $3, $4, 'active')`,
      [membershipId, tenantId, userId, roleRow.rows[0]!.id],
    );

    // The email+password shape: the same better-auth user, a credential
    // row whose account_id is the email rather than the user id. There is
    // NO canonical (account_id = user id) row for this identity.
    const foreignAccountId = `${p}@phone.aqua.local`;
    await admin.query(
      `insert into ba_account (id, user_id, account_id, provider_id, issuer, password, created_at, updated_at)
       values ($1, $2, $3, 'credential', 'local:credential', 'foreign-credential-sentinel', now(), now())`,
      [uuidv7(), baId, foreignAccountId],
    );

    const issued = await issueOwnerResetLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");
    const redeemed = await redeemLoginLink(issued.token, { pin: "424242" });
    expect(redeemed.kind).toBe("ok");

    // The app's own canonical view (four fields) must see the credential
    // the reset created, and the new PIN must work.
    expect(await hasCredentialByBaUserId(baId)).toBe(true);
    const signIn = await pinLogin(p, "424242");
    expect(signIn.status).toBe(200);

    // And the other row for the same identity must be untouched.
    const foreign = await admin.query<{ password: string }>(
      "select password from ba_account where user_id = $1 and account_id = $2",
      [baId, foreignAccountId],
    );
    expect(foreign.rows[0]!.password).toBe("foreign-credential-sentinel");
  });
});
