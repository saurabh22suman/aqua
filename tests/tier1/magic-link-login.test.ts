import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { withPlatform } from "@/db/scope";
import { tenantMemberships } from "@/db/schema/memberships";
import { locations } from "@/db/schema/locations";
import { inviteLinkUses } from "@/db/schema/invite-link-uses";
import { seedRoleTemplates } from "@/lib/services/roles";
import { inviteStaff } from "@/lib/services/staff-invitations";
import {
  INVITE_LINK_TTL_SECONDS,
  RELOGIN_LINK_TTL_SECONDS,
  signInviteLinkToken,
  verifyInviteLinkToken,
} from "@/lib/services/invite-link-token";
import {
  issueLoginLink,
  previewLoginLink,
  redeemLoginLink,
} from "@/lib/services/invite-link";
import { signParentLinkToken } from "@/lib/services/parent-link";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// Staff magic-link login: single-use, membership-bound invite and
// re-login links (architecture §6.1). Pure token properties need no
// database; single-use and status transitions go through a real
// tenant + membership and clean up after themselves. Distinct phone
// prefix (+91986) so the staff-invitations suite's +91987 cleanup
// can never touch these rows.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const TZ = "Asia/Kolkata";
const phone = (suffix: string) => `+91986${RUN_NUM}${suffix}`;

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
// One membership per redeem test -- each test owns its invite ->
// active transition, so no test depends on another's execution.
const membershipByTest: Record<string, string> = {};

describe("invite-link tokens (pure)", () => {
  const tid = "11111111-1111-7111-8111-111111111111";
  const mid = "22222222-2222-7222-8222-222222222222";

  it("round-trips sign -> verify with purpose and TTL", () => {
    const { token, claims } = signInviteLinkToken({
      tenantId: tid,
      membershipId: mid,
      purpose: "invite",
    });
    expect(claims.exp - claims.iat).toBe(INVITE_LINK_TTL_SECONDS);
    expect(INVITE_LINK_TTL_SECONDS).toBe(72 * 60 * 60);
    expect(RELOGIN_LINK_TTL_SECONDS).toBe(24 * 60 * 60);
    const back = verifyInviteLinkToken(token);
    expect(back).toMatchObject({
      tenantId: tid,
      membershipId: mid,
      purpose: "invite",
      jti: claims.jti,
    });
  });

  it("rejects tampered tokens", () => {
    const { token } = signInviteLinkToken({ tenantId: tid, membershipId: mid, purpose: "relogin" });
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(verifyInviteLinkToken(tampered)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const { token } = signInviteLinkToken({
      tenantId: tid,
      membershipId: mid,
      purpose: "invite",
      ttlSeconds: -10,
    });
    expect(verifyInviteLinkToken(token)).toBeNull();
  });

  it("rejects garbage shapes without throwing", () => {
    expect(verifyInviteLinkToken("")).toBeNull();
    expect(verifyInviteLinkToken("a.b")).toBeNull();
    expect(verifyInviteLinkToken("not-a-token")).toBeNull();
  });

  it("rejects parent-view tokens: the two link kinds are not interchangeable", () => {
    const { token } = signParentLinkToken({ tenantId: tid, personId: mid });
    expect(verifyInviteLinkToken(token)).toBeNull();
  });
});

describe("invite-link issue/preview/redeem (database)", () => {
  beforeAll(async () => {
    tenantId = asTenantId(uuidv7());
    const plan = (
      await admin.query<{ id: string }>("select id from plans where is_default = true")
    ).rows[0];
    await admin.query(
      "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Link Test', $3, $4)",
      [tenantId, `link-${RUN}`, plan?.id ?? null, TZ],
    );
    await withTenant(tenantId, async (tx) => {
      await tx.insert(locations).values({ tenantId, name: "Main", isPrimary: true });
    });
    await seedRoleTemplates(tenantId);
    for (const [test, suffix] of [
      ["issue", "01"],
      ["preview", "02"],
      ["redeem", "03"],
      ["singleUse", "04"],
      ["relogin", "05"],
    ] as const) {
      const invited = await inviteStaff(
        { tenantId, userId: SYSTEM_USER },
        { phone: phone(suffix), fullName: "Link Coach", roleKey: "coach", locationIds: [] },
      );
      if (invited.kind !== "ok") throw new Error(`setup invite failed: ${invited.kind}`);
      membershipByTest[test] = invited.membershipId;
    }
  });

  afterAll(async () => {
    if (tenantId) {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(inviteLinkUses).where(eq(inviteLinkUses.tenantId, tenantId));
        await tx.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
        await tx.delete(locations).where(eq(locations.tenantId, tenantId));
      });
      await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
      await admin.query("delete from roles where tenant_id = $1", [tenantId]);
      await admin.query("delete from tenants where id = $1", [tenantId]);
    }
    for (const suffix of ["01", "02", "03", "04", "05"]) {
      const p = phone(suffix);
      await admin.query("delete from ba_session where user_id in (select id from ba_user where phone_number = $1)", [p]);
      await admin.query("delete from ba_user where phone_number = $1", [p]);
      await admin.query("delete from users where phone = $1", [p]);
    }
    await admin.end();
  });

  it("issues an invite-purpose link for an invited membership", async () => {
    const membershipId = membershipByTest["issue"]!;
    const result = await issueLoginLink(tenantId, membershipId);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.purpose).toBe("invite");
    expect(result.urlPath.startsWith("/login/link/")).toBe(true);
    expect(result.phone).toBe(phone("01"));
    expect(result.roleKey).toBe("coach");
    expect(result.tenantName).toBe("Link Test");
  });

  it("previews without consuming", async () => {
    const membershipId = membershipByTest["preview"]!;
    const issued = await issueLoginLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const preview = await previewLoginLink(issued.token);
    expect(preview.kind).toBe("ok");
    if (preview.kind !== "ok") return;
    expect(preview.phone).toBe(phone("02"));
    // Still redeemable afterwards -- preview consumed nothing.
    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
  });

  it("redeems once: flips invited -> active, mints a session, lands on the role home", async () => {
    const membershipId = membershipByTest["redeem"]!;
    const before = await withTenant(tenantId, (tx) =>
      tx
        .select({ status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId)),
    );
    expect(before[0]?.status).toBe("invited");

    const issued = await issueLoginLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const redeemed = await redeemLoginLink(issued.token);
    expect(redeemed.kind).toBe("ok");
    if (redeemed.kind !== "ok") return;
    expect(redeemed.homePath).toBe("/coach");
    expect(typeof redeemed.sessionToken).toBe("string");

    const after = await withTenant(tenantId, (tx) =>
      tx
        .select({ status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId)),
    );
    expect(after[0]?.status).toBe("active");

    const sessions = await withPlatform(() =>
      admin.query("select count(*)::int as n from ba_session where token = $1", [
        redeemed.sessionToken,
      ]),
    );
    expect(sessions.rows[0].n).toBe(1);
  });

  it("refuses the second redeem of the same link (single-use)", async () => {
    const membershipId = membershipByTest["singleUse"]!;
    const issued = await issueLoginLink(tenantId, membershipId);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const first = await redeemLoginLink(issued.token);
    expect(first.kind).toBe("ok");
    const second = await redeemLoginLink(issued.token);
    expect(second).toMatchObject({ kind: "error", code: "used" });
  });

  it("issues relogin-purpose links for active memberships", async () => {
    const membershipId = membershipByTest["relogin"]!;
    // Activate first with an invite link, mirroring the real flow.
    const invite = await issueLoginLink(tenantId, membershipId);
    if (invite.kind !== "ok") throw new Error("setup issue failed");
    expect(invite.purpose).toBe("invite");
    expect((await redeemLoginLink(invite.token)).kind).toBe("ok");

    const result = await issueLoginLink(tenantId, membershipId);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.purpose).toBe("relogin");
    const redeemed = await redeemLoginLink(result.token);
    expect(redeemed.kind).toBe("ok");
  });
});
