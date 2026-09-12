// @vitest-environment node
//
// Slice 12 — demo PIN seeding.
//
// Demo users log in with phone + PIN now, so the demo seeds must
// create credentials. setCredentialForPhone is the same helper a
// future ops bootstrap would use: ensure the users + ba_user rows,
// then set the credential.

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";
import { pinLogin, setCredentialForPhone } from "@/lib/services/credentials";
import { DEMO_PIN } from "@/scripts/lib/demo-credentials";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN_NUM = Date.now() % 1000000;
const phone = `+91994${RUN_NUM}`;

afterAll(async () => {
  await admin.query(
    "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
    [phone],
  );
  await admin.query(
    "delete from ba_account where user_id in (select id from ba_user where phone_number = $1)",
    [phone],
  );
  await admin.query("delete from ba_user where phone_number = $1", [phone]);
  await admin.query("delete from users where phone = $1", [phone]);
  await admin.end();
});

describe("demo credentials", () => {
  it("DEMO_PIN is a 6-digit PIN (valid under the product policy)", () => {
    expect(DEMO_PIN).toMatch(/^\d{6}$/);
  });

  it("setCredentialForPhone creates identity + credential; the demo PIN signs in", async () => {
    await setCredentialForPhone(phone, DEMO_PIN);
    const res = await pinLogin(phone, DEMO_PIN);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
  });

  it("is idempotent: seeding again overwrites the same credential without duplicating rows", async () => {
    await setCredentialForPhone(phone, DEMO_PIN);
    const accounts = await admin.query<{ n: string }>(
      "select count(*)::text as n from ba_account where user_id in (select id from ba_user where phone_number = $1) and provider_id = 'credential'",
      [phone],
    );
    expect(accounts.rows[0]!.n).toBe("1");
    const usersRows = await admin.query<{ n: string }>(
      "select count(*)::text as n from users where phone = $1",
      [phone],
    );
    expect(usersRows.rows[0]!.n).toBe("1");
  });
});
