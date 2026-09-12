// @vitest-environment node
//
// Slice 3 — signup-disabled guard.
//
// better-auth's emailAndPassword provider, when enabled, registers
// a public /api/auth/sign-up/email endpoint. That's an open door
// to account creation — anyone who can reach it can mint a ba_user
// row, attach a credential, and try to log in. With the platform
// model (every identity links back to a real tenant membership via
// users.better_auth_id), an orphan ba_user is a soft risk, but
// enabling the door at all invites brute-force noise against
// /api/auth/sign-in/email. The mechanical fix is
// disableSignUp: true on the emailAndPassword config.
//
// This is a guard test — it passes before any code change
// (emailAndPassword is currently off entirely, so the endpoint is
// 404), and must continue to pass once emailAndPassword is enabled
// with disableSignUp: true. It fails only if a regression
// introduces an open sign-up door.

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const STAMP = Date.now().toString(36);

afterAll(async () => {
  await admin.end();
});

async function callSignUp(email: string, password: string): Promise<Response> {
  // The catch-all auth handler is what the public route delegates to
  // (app/api/auth/[...all]/route.ts:6). Calling it directly is the
  // honest end-to-end probe — a custom server action or a fake
  // fetch would test the wrong layer.
  const req = new Request("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "guard" }),
  });
  return auth.handler(req);
}

describe("emailAndPassword sign-up is disabled", () => {
  it("POST /api/auth/sign-up/email is refused and creates no ba_user", async () => {
    const email = `guard-${STAMP}@example.com`;
    const password = "a-twelve-character-password";

    const res = await callSignUp(email, password);
    // better-auth returns BAD_REQUEST with EMAIL_PASSWORD_SIGN_UP_DISABLED
    // when disableSignUp is true, OR 404 when the endpoint is not
    // registered at all (emailAndPassword.enabled = false). Both are
    // acceptable — the rule is "an open 200 with a ba_user row is
    // the only outcome that fails this test".
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // No ba_user row was created for the email we tried.
    const ba = await withPlatform(() =>
      admin.query("select id from ba_user where email = $1", [email]),
    );
    expect(ba.rows).toHaveLength(0);

    // No ba_account row either (sign-up would normally insert one).
    const acc = await withPlatform(() =>
      admin.query("select id from ba_account where account_id = $1", [email]),
    );
    expect(acc.rows).toHaveLength(0);
  });

  it("after multiple attempts, no ba_user has been created for the tried emails", async () => {
    const emails = [
      `guard-a-${STAMP}-${uuidv7().slice(0, 6)}@example.com`,
      `guard-b-${STAMP}-${uuidv7().slice(0, 6)}@example.com`,
      `guard-c-${STAMP}-${uuidv7().slice(0, 6)}@example.com`,
    ];
    for (const email of emails) {
      const res = await callSignUp(email, "a-twelve-character-password");
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const ba = await withPlatform(() =>
      admin.query(
        "select count(*)::int as n from ba_user where email = any($1)",
        [emails],
      ),
    );
    expect((ba.rows[0] as { n: number }).n).toBe(0);
  });
});
