import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { auth } from "@/lib/auth/server";
import { NotFoundError, resolveCtxFor } from "@/lib/auth/context";
import { setOtpSink } from "@/lib/auth/otp-delivery";
import { env } from "@/lib/env";
import { withPlatform } from "@/db/scope";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const capturedCodes = new Map<string, string>();
setOtpSink((phoneNumber, code) => {
  capturedCodes.set(phoneNumber, code);
});

const RUN = Date.now().toString(36);
let tenantA = "";
let tenantB = "";
let linkedUserId = "";

async function expectApiError(
  promise: Promise<unknown>,
): Promise<{ status?: number; message?: string }> {
  try {
    await promise;
    return {};
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return { status: e.status, message: e.message };
  }
}

afterAll(async () => {
  await admin.query(
    "delete from tenant_memberships where user_id in (select id from users where phone in ($1,$2))",
    ["+919900000001", "+919900000002"],
  );
  await admin.query("delete from tenants where slug like 'auth-a-%' or slug like 'auth-b-%'");
  await admin.query(
    "delete from users where phone in ('+919900000001','+919900000002')",
  );
  await admin.query(
    "delete from ba_user where phone_number in ('+919900000001','+919900000002')",
  );
  await admin.end();
});

describe("auth and request context", () => {
  it("verifies a correct OTP, creates a session, links the platform user", async () => {
    const phone = "+919900000001";

    // better-auth does not propagate ALS; this wrap is load-bearing, do not remove
    await withPlatform(() => auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } }));
    expect(capturedCodes.has(phone)).toBe(true);

    const code = capturedCodes.get(phone)!;
    // better-auth does not propagate ALS; this wrap is load-bearing, do not remove
    await withPlatform(() => auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code } }));

    const ba = await admin.query(
      "select u.id from ba_user u where u.phone_number = $1 and u.phone_number_verified = true",
      [phone],
    );
    expect(ba.rows).toHaveLength(1);

    const linked = await admin.query(
      "select id, better_auth_id from users where phone = $1",
      [phone],
    );
    expect(linked.rows).toHaveLength(1);
    expect(linked.rows[0].better_auth_id).toBe(ba.rows[0].id);

    const sessions = await admin.query(
      "select count(*)::int as n from ba_session s join ba_user u on u.id = s.user_id where u.phone_number = $1",
      [phone],
    );
    expect(sessions.rows[0].n).toBeGreaterThanOrEqual(1);

    linkedUserId = linked.rows[0].id;
  });

  it("locks out after five wrong attempts — even the correct code is then rejected", async () => {
    const phone = "+919900000002";

    // better-auth does not propagate ALS; this wrap is load-bearing, do not remove
    await withPlatform(() => auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } }));
    const code = capturedCodes.get(phone)!;

    for (let i = 0; i < 5; i++) {
      const err = await expectApiError(
          withPlatform(() =>
          auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: "000000" } }),
        ),
      );
      if (i < 4) expect(err.status).not.toBe(403);
    }

    const finalErr = await expectApiError(
      withPlatform(() => auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code } })),
    );
    expect(finalErr.message).toMatch(/too many attempts/i);

    const sessions = await admin.query(
      "select count(*)::int as n from ba_session s join ba_user u on u.id = s.user_id where u.phone_number = $1",
      [phone],
    );
    expect(sessions.rows[0].n).toBe(0);
  });

  it("resolves ctx for own slug and returns 404 semantics for another tenant's slug", async () => {
    tenantA = uuidv7();
    tenantB = uuidv7();

    await admin.query(
      "insert into tenants (id, slug, name) values ($1,$2,'Auth A')",
      [tenantA, `auth-a-${RUN}`],
    );
    await admin.query(
      "insert into tenants (id, slug, name) values ($1,$2,'Auth B')",
      [tenantB, `auth-b-${RUN}`],
    );

    const membershipId = uuidv7();
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role, status) values ($1,$2,$3,'owner','active')",
      [membershipId, tenantA, linkedUserId],
    );

    const betterAuthId = (
      await admin.query(
        "select better_auth_id from users where id = $1",
        [linkedUserId],
      )
    ).rows[0].better_auth_id;

    const ctx = await resolveCtxFor(betterAuthId, `auth-a-${RUN}`);
    expect(ctx.role).toBe("owner");
    expect(ctx.tenantId).toBe(tenantA);
    expect(ctx.locationIds).toEqual([]);

    await expect(resolveCtxFor(betterAuthId, `auth-b-${RUN}`)).rejects.toThrow(
      NotFoundError,
    );
    await expect(resolveCtxFor(betterAuthId, "no-such-slug")).rejects.toThrow(
      NotFoundError,
    );
  });
});
