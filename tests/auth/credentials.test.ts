// @vitest-environment node
//
// Slice 3 — credentials service.
//
// The phone+PIN login delegates verification + session mint to
// better-auth's emailAndPassword provider (identity IS ba_user; the
// temp email + password slot already exists). This service wraps the
// calls that need to be done as the platform:
//   - findOrCreate ba_user + credential account (first-time set)
//   - phone -> ba_user.email lookup (the stored email may be the
//     stripped form the OTP plugin wrote, not the canonical +91 form
//     — never recompose; look it up)
//   - signInEmail + Set-Cookie relay
//   - per-account lockout counters (failed_pin_attempts, pin_locked_until)
//
// Tests run against the dev DB the rest of the suite uses — no
// testcontainer. Lockout counters and ba_session rows are cleaned
// in afterAll so this file is safe alongside any other test.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { withPlatform } from "@/db/scope";
import {
  setCredential,
  hasCredentialByPhone,
  pinLogin,
  clearPinFailures,
} from "@/lib/services/credentials";
import { normaliseToE164 } from "@/lib/phone";
import { asUserId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

// All phones in this file share this prefix so cleanup is a single
// LIKE clause; distinct UUIDv7 tails keep them unique.
const PREFIX = `+91cr${Date.now().toString(36).slice(-4)}`;
const phoneFor = (suffix: string): string => `${PREFIX}${suffix}`;

async function cleanupRow(userId: string, phone: string): Promise<void> {
  const baIds = await admin.query<{ id: string }>(
    "select id from ba_user where phone_number = $1",
    [phone],
  );
  for (const r of baIds.rows) {
    await admin.query("delete from ba_session where user_id = $1", [r.id]);
    await admin.query("delete from ba_account where user_id = $1", [r.id]);
  }
  await admin.query("delete from ba_user where phone_number = $1", [phone]);
  await admin.query("delete from users where id = $1", [userId]);
}

// One user/ba_user per test owns its state end-to-end. Each `it` calls
// seedUser() to get a fresh identity; cleanup runs in afterEach so a
// failure mid-test still cleans up.
async function seedUser(): Promise<{ userId: UserId; phone: string; baUserId: string }> {
  const userId = asUserId(uuidv7());
  const phone = normaliseToE164(phoneFor(userId.slice(-6)));
  await withPlatform(async () => {
    await db.insert(users).values({ id: userId, phone });
  });
  // ba_user — created with the same temp-email shape the phone OTP
  // plugin uses, so a future OTP login (when SMS lands) merges into
  // the same row.
  const baId = uuidv7();
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: baId,
      name: phone,
      email: `${phone}@phone.aqua.local`,
      phoneNumber: phone,
      phoneNumberVerified: true,
    });
  });
  return { userId, phone, baUserId: baId };
}

afterEach(async () => {
  // Wipe every user that matches the run's PREFIX. Belt-and-braces
  // so a test that threw between seed and cleanup doesn't leak rows.
  const rows = await admin.query<{ id: string; phone: string }>(
    `select id, phone from users where phone like $1`,
    [`${PREFIX}%`],
  );
  for (const r of rows.rows) {
    await cleanupRow(r.id, r.phone);
  }
});

afterAll(async () => {
  await admin.end();
});

describe("lib/services/credentials — setCredential / hasCredentialByPhone", () => {
  it("setCredential creates a credential account; hasCredentialByPhone flips false→true", async () => {
    const { phone, baUserId } = await seedUser();
    expect(await hasCredentialByPhone(phone)).toBe(false);

    await setCredential(baUserId, "123456");

    expect(await hasCredentialByPhone(phone)).toBe(true);
    // The credential row is the one better-auth's signInEmail finds.
    const r = await admin.query<{ provider_id: string; account_id: string }>(
      "select provider_id, account_id from ba_account where user_id = $1 and provider_id = 'credential'",
      [baUserId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.account_id).toBe(baUserId);
    // The password column is non-null and non-empty (hash, not plaintext).
    const r2 = await admin.query<{ password: string }>(
      "select password from ba_account where user_id = $1 and provider_id = 'credential'",
      [baUserId],
    );
    expect(typeof r2.rows[0]?.password).toBe("string");
    expect(r2.rows[0]!.password.length).toBeGreaterThan(20);
    expect(r2.rows[0]!.password).not.toBe("123456");
  });

  it("setCredential overwrites an existing credential (used by reset redeem path)", async () => {
    const { phone, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");
    const before = await admin.query<{ password: string }>(
      "select password from ba_account where user_id = $1 and provider_id = 'credential'",
      [baUserId],
    );
    await setCredential(baUserId, "654321");
    const after = await admin.query<{ password: string }>(
      "select password from ba_account where user_id = $1 and provider_id = 'credential'",
      [baUserId],
    );
    expect(after.rows[0]!.password).not.toBe(before.rows[0]!.password);
    expect(await hasCredentialByPhone(phone)).toBe(true);
  });
});

describe("lib/services/credentials — pinLogin (success and lockout)", () => {
  it("pinLogin with the correct PIN returns a 200 Response that sets the session cookie", async () => {
    const { phone, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");

    const res = await pinLogin(phone, "123456");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
    // A ba_session row now exists for this user.
    const sessions = await admin.query<{ n: string }>(
      "select count(*)::text as n from ba_session where user_id = $1",
      [baUserId],
    );
    expect(parseInt(sessions.rows[0]!.n, 10)).toBeGreaterThan(0);
  });

  it("pinLogin with the wrong PIN returns a generic 4xx and bumps failed_pin_attempts", async () => {
    const { phone, userId, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");

    const res = await pinLogin(phone, "000000");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // Counter went from 0 to 1.
    const r = await admin.query<{ failed_pin_attempts: number }>(
      "select failed_pin_attempts from users where id = $1",
      [userId],
    );
    expect(r.rows[0]!.failed_pin_attempts).toBe(1);
    // No session was minted.
    const sessions = await admin.query<{ n: string }>(
      "select count(*)::text as n from ba_session where user_id = $1",
      [baUserId],
    );
    expect(sessions.rows[0]!.n).toBe("0");
  });

  it("five wrong PINs sets pin_locked_until; sixth attempt with correct PIN is still refused", async () => {
    const { phone, userId, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");

    for (let i = 0; i < 5; i++) {
      const r = await pinLogin(phone, "000000");
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    const locked = await admin.query<{ pin_locked_until: Date | null }>(
      "select pin_locked_until from users where id = $1",
      [userId],
    );
    expect(locked.rows[0]?.pin_locked_until).not.toBeNull();
    expect(locked.rows[0]!.pin_locked_until!.getTime()).toBeGreaterThan(Date.now());

    // Correct PIN while locked — still refused. Counter must NOT
    // increment further (the lockout predicate fires before the
    // credential check, so the lockout window doesn't reset on
    // attacker attempts during the lock).
    const correctWhileLocked = await pinLogin(phone, "123456");
    expect(correctWhileLocked.status).toBeGreaterThanOrEqual(400);
    const still = await admin.query<{ failed_pin_attempts: number }>(
      "select failed_pin_attempts from users where id = $1",
      [userId],
    );
    expect(still.rows[0]!.failed_pin_attempts).toBe(5);
  });

  it("a successful pinLogin resets the failure counter", async () => {
    const { phone, userId, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");
    // Three wrong attempts.
    for (let i = 0; i < 3; i++) await pinLogin(phone, "000000");
    const before = await admin.query<{ failed_pin_attempts: number }>(
      "select failed_pin_attempts from users where id = $1",
      [userId],
    );
    expect(before.rows[0]!.failed_pin_attempts).toBe(3);

    // One correct attempt.
    const ok = await pinLogin(phone, "123456");
    expect(ok.status).toBe(200);

    const after = await admin.query<{ failed_pin_attempts: number; pin_locked_until: Date | null }>(
      "select failed_pin_attempts, pin_locked_until from users where id = $1",
      [userId],
    );
    expect(after.rows[0]!.failed_pin_attempts).toBe(0);
    expect(after.rows[0]!.pin_locked_until).toBeNull();
  });

  it("clearing the lock via clearPinFailures lets the correct PIN through", async () => {
    const { phone, userId, baUserId } = await seedUser();
    await setCredential(baUserId, "123456");
    for (let i = 0; i < 5; i++) await pinLogin(phone, "000000");
    const before = await admin.query<{ pin_locked_until: Date | null }>(
      "select pin_locked_until from users where id = $1",
      [userId],
    );
    expect(before.rows[0]!.pin_locked_until).not.toBeNull();

    await clearPinFailures(userId);

    const after = await admin.query<{ failed_pin_attempts: number; pin_locked_until: Date | null }>(
      "select failed_pin_attempts, pin_locked_until from users where id = $1",
      [userId],
    );
    expect(after.rows[0]!.failed_pin_attempts).toBe(0);
    expect(after.rows[0]!.pin_locked_until).toBeNull();

    const ok = await pinLogin(phone, "123456");
    expect(ok.status).toBe(200);
  });

  it("an unknown phone returns a generic 4xx and does not create a user", async () => {
    const unknown = phoneFor("unknown");
    const res = await pinLogin(unknown, "123456");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const u = await admin.query<{ n: string }>(
      "select count(*)::text as n from users where phone = $1",
      [unknown],
    );
    expect(u.rows[0]!.n).toBe("0");
    const b = await admin.query<{ n: string }>(
      "select count(*)::text as n from ba_user where phone_number = $1",
      [unknown],
    );
    expect(b.rows[0]!.n).toBe("0");
  });
});
