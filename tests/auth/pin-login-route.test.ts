// @vitest-environment node
//
// Slice 6 — POST /api/login/pin.
//
// The phone+PIN login door. Route-level: a real Request comes in, a
// signed better-auth session cookie goes out. Wrong PINs are generic
// 401s; the per-account lockout from the credentials service still
// applies underneath.

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { setCredential } from "@/lib/services/credentials";
import { POST } from "@/app/api/login/pin/route";
import { asUserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91991${RUN_NUM}${suffix}`;

const createdUserIds: string[] = [];

async function seedUser(suffix: string): Promise<{ userId: string; phone: string; baUserId: string }> {
  const userId = asUserId(uuidv7());
  const p = phone(suffix);
  const baId = uuidv7();
  createdUserIds.push(userId);
  await withPlatform(async () => {
    await db.insert(users).values({ id: userId, phone: p });
    await db.insert(baUser).values({
      id: baId,
      name: p,
      email: `${p}@phone.aqua.local`,
      phoneNumber: p,
      phoneNumberVerified: true,
    });
  });
  return { userId, phone: p, baUserId: baId };
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    const baRow = await admin.query<{ better_auth_id: string | null }>(
      "select better_auth_id from users where id = $1",
      [userId],
    );
    const baId = baRow.rows[0]?.better_auth_id;
    if (baId) {
      await admin.query("delete from ba_session where user_id = $1", [baId]);
      await admin.query("delete from ba_account where user_id = $1", [baId]);
      await admin.query("delete from ba_user where id = $1", [baId]);
    }
    await admin.query("delete from users where id = $1", [userId]);
  }
  await admin.end();
});

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/login/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/login/pin", () => {
  it("signs in with the correct phone + PIN and sets the session cookie", async () => {
    const { baUserId, phone: p } = await seedUser("01");
    await setCredential(baUserId, "123456");
    const res = await post({ phone: p, pin: "123456" });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe("ok");
  });

  it("returns a generic 401 for a wrong PIN", async () => {
    const { baUserId, phone: p } = await seedUser("02");
    await setCredential(baUserId, "123456");
    const res = await post({ phone: p, pin: "000000" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { kind: string; code: string };
    expect(body.kind).toBe("error");
    expect(body.code).toBe("invalid_credentials");
  });

  it("returns a generic 401 for an unknown phone (no enumeration)", async () => {
    const res = await post({ phone: phone("99"), pin: "123456" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { kind: string; code: string };
    expect(body.kind).toBe("error");
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects a malformed body with 400", async () => {
    const missing = await post({ phone: phone("01") });
    expect(missing.status).toBe(400);
    const nonDigits = await post({ phone: phone("01"), pin: "abcdef" });
    expect(nonDigits.status).toBe(400);
    const tooShort = await post({ phone: phone("01"), pin: "12345" });
    expect(tooShort.status).toBe(400);
  });

  it("locks out after five wrong PINs: the sixth (correct) attempt is 401", async () => {
    const { baUserId, phone: p } = await seedUser("03");
    await setCredential(baUserId, "123456");
    for (let i = 0; i < 5; i++) {
      const r = await post({ phone: p, pin: "000000" });
      expect(r.status).toBe(401);
    }
    const correct = await post({ phone: p, pin: "123456" });
    expect(correct.status).toBe(401);
    const rows = await admin.query<{ failed_pin_attempts: number; pin_locked_until: Date | null }>(
      "select failed_pin_attempts, pin_locked_until from users where phone = $1",
      [p],
    );
    expect(rows.rows[0]!.failed_pin_attempts).toBe(5);
    expect(rows.rows[0]!.pin_locked_until).not.toBeNull();
  });
});
