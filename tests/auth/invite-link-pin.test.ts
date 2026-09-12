// @vitest-environment node
//
// Slice 4 — set-PIN on magic-link redeem.
//
// The magic link is the first credential. Redemption must now:
//   - tell the caller whether a credential already exists
//     (preview.credentialSet), so the UI can show the set-PIN form
//     instead of the plain confirm screen;
//   - accept an optional PIN and set it in the same trip, so the
//     owner/staff member never lands in a session without a credential;
//   - refuse to overwrite an existing PIN via an invite/relogin link
//     (only a reset link may overwrite);
//   - validate the PIN shape BEFORE consuming the single-use jti, so a
//     malformed PIN does not burn the link.
//
// Reset-specific behavior (owner-only, revocation) lives in
// tests/auth/owner-reset-link.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { locations } from "@/db/schema/locations";
import { inviteLinkUses } from "@/db/schema/invite-link-uses";
import { persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import { seedRoleTemplates } from "@/lib/services/roles";
import { inviteStaff } from "@/lib/services/staff-invitations";
import {
  issueLoginLink,
  previewLoginLink,
  redeemLoginLink,
} from "@/lib/services/invite-link";
import { hasCredentialByPhone, setCredential } from "@/lib/services/credentials";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91988${RUN_NUM}${suffix}`;

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
const membershipByTest: Record<string, string> = {};
const invitedByTest: Record<string, { membershipId: string; phone: string }> = {};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Pin Link Test', $3, 'Asia/Kolkata')",
    [tenantId, `pin-link-${RUN}`, plan?.id ?? null],
  );
  await withTenant(tenantId, async (tx) => {
    await tx.insert(locations).values({ tenantId, name: "Main", isPrimary: true });
  });
  await seedRoleTemplates(tenantId);
  for (const [test, suffix] of [
    ["previewNone", "01"],
    ["noPin", "02"],
    ["withPin", "03"],
    ["previewSet", "04"],
    ["reloginGuard", "05"],
    ["badPin", "06"],
    ["inviteGuard", "07"],
  ] as const) {
    const invited = await inviteStaff(
      { tenantId, userId: SYSTEM_USER },
      { phone: phone(suffix), fullName: "Pin Link Coach", roleKey: "coach", locationIds: [] },
    );
    if (invited.kind !== "ok") throw new Error(`setup invite failed: ${invited.kind}`);
    membershipByTest[test] = invited.membershipId;
    invitedByTest[test] = { membershipId: invited.membershipId, phone: phone(suffix) };
  }
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(inviteLinkUses).where(eq(inviteLinkUses.tenantId, tenantId));
      await tx.delete(staff).where(eq(staff.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  for (const suffix of ["01", "02", "03", "04", "05", "06", "07"]) {
    const p = phone(suffix);
    await admin.query(
      "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
      [p],
    );
    await admin.query("delete from ba_account where user_id in (select id from ba_user where phone_number = $1)", [p]);
    await admin.query("delete from ba_user where phone_number = $1", [p]);
    await admin.query("delete from users where phone = $1", [p]);
  }
  await admin.end();
});

async function baUserIdFor(p: string): Promise<string> {
  const r = await admin.query<{ id: string }>("select id from ba_user where phone_number = $1", [p]);
  if (!r.rows[0]?.id) throw new Error(`no ba_user for ${p}`);
  return r.rows[0].id;
}

async function membershipStatus(membershipId: string): Promise<string | undefined> {
  const r = await admin.query<{ status: string }>(
    "select status from tenant_memberships where id = $1",
    [membershipId],
  );
  return r.rows[0]?.status;
}

describe("preview reports credential state", () => {
  it("credentialSet is false for a fresh invited membership", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["previewNone"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const preview = await previewLoginLink(issued.token);
    expect(preview.kind).toBe("ok");
    if (preview.kind !== "ok") return;
    expect(preview.credentialSet).toBe(false);
  });

  it("credentialSet is true once a credential exists", async () => {
    const { membershipId, phone: p } = invitedByTest["previewSet"]!;
    const invite = await issueLoginLink(tenantId, membershipId);
    if (invite.kind !== "ok") throw new Error("setup issue failed");
    const redeemed = await redeemLoginLink(invite.token);
    expect(redeemed.kind).toBe("ok");
    await setCredential(await baUserIdFor(p), "123456");

    const issued = await issueLoginLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const preview = await previewLoginLink(issued.token);
    expect(preview.kind).toBe("ok");
    if (preview.kind !== "ok") return;
    expect(preview.credentialSet).toBe(true);
  });
});

describe("redeem sets the PIN in the same trip", () => {
  it("without a PIN on a credential-less membership: ok, needsCredential, lands on /set-pin", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["noPin"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
    if (redeemed.kind !== "ok") return;
    expect(redeemed.homePath).toBe("/set-pin");
    expect(redeemed.needsCredential).toBe(true);
    // The membership still flipped active (the link was consumed).
    expect(await membershipStatus(membershipByTest["noPin"]!)).toBe("active");
  });

  it("with a PIN: sets the credential, flips active, mints a session, lands on the role home", async () => {
    const { membershipId, phone: p } = invitedByTest["withPin"]!;
    const issued = await issueLoginLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const redeemed = await redeemLoginLink(issued.token, { pin: "654321" });
    expect(redeemed.kind).toBe("ok");
    if (redeemed.kind !== "ok") return;
    expect(redeemed.homePath).toBe("/coach");
    expect(redeemed.needsCredential).toBe(false);
    expect(await membershipStatus(membershipId)).toBe("active");
    expect(await hasCredentialByPhone(p)).toBe(true);
    const sessions = await admin.query<{ n: string }>(
      "select count(*)::text as n from ba_session where user_id = $1",
      [await baUserIdFor(p)],
    );
    expect(parseInt(sessions.rows[0]!.n, 10)).toBeGreaterThan(0);
  });

  it("relogin link with a PIN refuses to overwrite an existing credential and does not consume the link", async () => {
    const { membershipId, phone: p } = invitedByTest["reloginGuard"]!;
    const invite = await issueLoginLink(tenantId, membershipId);
    if (invite.kind !== "ok") throw new Error("setup issue failed");
    expect((await redeemLoginLink(invite.token)).kind).toBe("ok");
    await setCredential(await baUserIdFor(p), "111111");

    const relogin = await issueLoginLink(tenantId, membershipId);
    if (relogin.kind !== "ok") throw new Error("setup issue failed");
    const refused = await redeemLoginLink(relogin.token, { pin: "222222" });
    expect(refused).toMatchObject({ kind: "error", code: "credential_already_set" });

    // The link must still work for a normal login (no PIN).
    const normal = await redeemLoginLink(relogin.token);
    expect(normal.kind).toBe("ok");
    if (normal.kind !== "ok") return;
    expect(normal.needsCredential).toBe(false);
  });

  it("invite link with a PIN refuses when a credential already exists (no silent reset)", async () => {
    const { membershipId, phone: p } = invitedByTest["inviteGuard"]!;
    const invite = await issueLoginLink(tenantId, membershipId);
    if (invite.kind !== "ok") throw new Error("setup issue failed");
    expect((await redeemLoginLink(invite.token)).kind).toBe("ok");
    await setCredential(await baUserIdFor(p), "111111");

    // A second invite-shaped link is not normally minted for an active
    // membership (issueLoginLink derives relogin), but the redeem path
    // must be safe even if one arrives: hand-sign an invite-purpose
    // token for the same membership.
    const { signInviteLinkToken } = await import("@/lib/services/invite-link-token");
    const forged = signInviteLinkToken({
      tenantId,
      membershipId,
      purpose: "invite",
    });
    const refused = await redeemLoginLink(forged.token, { pin: "222222" });
    expect(refused).toMatchObject({ kind: "error", code: "credential_already_set" });
  });

  it("malformed PIN is rejected before the jti is consumed", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["badPin"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const refused = await redeemLoginLink(issued.token, { pin: "abc" });
    expect(refused).toMatchObject({ kind: "error", code: "invalid_pin" });

    // Link still redeems (was not consumed).
    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
  });

  it("a 5-digit PIN is rejected (minimum is 6)", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["previewNone"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const refused = await redeemLoginLink(issued.token, { pin: "12345" });
    expect(refused).toMatchObject({ kind: "error", code: "invalid_pin" });
  });
});
