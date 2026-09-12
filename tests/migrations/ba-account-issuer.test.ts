import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";

// Slice 3 — ba_account.issuer.
//
// better-auth 1.7.1 introduced an `issuer` field on accounts
// (createLocalAccountIssuer("credential") === "local:credential").
// Its internal findCredentialAccount filters on
// (userId, providerId, issuer, accountId); the @better-auth/drizzle-
// adapter builds that WHERE clause through the Drizzle schema object
// — a missing field becomes an empty SQL fragment, and the query
// fails with a syntax error. The schema drift predates this feature
// (ba_account was created by migration 0005 from an older
// better-auth), but the phone+PIN flow is the first code path that
// calls findCredentialAccount, so the fix lands here.
//
// The migration adds the column and backfills existing credential
// rows. New rows are written by better-auth's linkAccount, which
// supplies the issuer itself.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.query("delete from ba_account where user_id = $1", [userId]);
    await admin.query("delete from ba_user where id = $1", [userId]);
  }
  await admin.end();
});

describe("ba_account issuer migration: 20260912000200_ba_account_issuer.sql", () => {
  it("exists, adds the issuer column, and backfills credential rows", () => {
    const sql = readFileSync(
      "db/migrations/20260912000200_ba_account_issuer.sql",
      "utf8",
    );
    expect(sql).toMatch(/alter\s+table\s+ba_account/i);
    expect(sql).toMatch(/add\s+column\s+issuer/i);
    expect(sql).toMatch(/update\s+ba_account/i);
    expect(sql).toMatch(/local:credential/);
    expect(sql).not.toMatch(/drop\s+table/i);
  });

  it("adds a nullable text issuer column to ba_account", async () => {
    const rows = await admin.query<{
      data_type: string;
      is_nullable: string;
    }>(
      `select data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'ba_account'
          and column_name = 'issuer'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.data_type).toBe("text");
    // Nullable on purpose: better-auth writes an issuer on every
    // account it creates, but a NOT NULL would require inventing a
    // value for legacy rows of providers we don't use.
    expect(rows.rows[0]!.is_nullable).toBe("YES");
  });

  it("a credential row with issuer 'local:credential' is found by better-auth's exact where shape", async () => {
    const userId = uuidv7();
    const accountId = uuidv7();
    createdUserIds.push(userId);
    await admin.query(
      `insert into ba_user (id, name, email, email_verified, phone_number, phone_number_verified)
       values ($1, 'issuer-test', $2, false, null, false)`,
      [userId, `${RUN}-issuer@example.com`],
    );
    await admin.query(
      `insert into ba_account (id, user_id, account_id, provider_id, issuer, password)
       values ($1, $2, $3, 'credential', 'local:credential', 'hash')`,
      [accountId, userId, userId],
    );
    // This reproduces the adapter's WHERE clause verbatim (the
    // columns it filters on, in the order it filters them). Before
    // the migration this was a syntax error; after, it returns the
    // row.
    const found = await admin.query<{ id: string }>(
      `select id from ba_account
        where user_id = $1 and provider_id = $2 and issuer = $3 and account_id = $4`,
      [userId, "credential", "local:credential", userId],
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]!.id).toBe(accountId);
  });

  it("the backfill SQL labels legacy credential rows (issuer null) with 'local:credential'", async () => {
    const userId = uuidv7();
    createdUserIds.push(userId);
    await admin.query(
      `insert into ba_user (id, name, email, email_verified, phone_number, phone_number_verified)
       values ($1, 'legacy-issuer-test', $2, false, null, false)`,
      [userId, `${RUN}-legacy@example.com`],
    );
    // Legacy shape: credential row with no issuer.
    await admin.query(
      `insert into ba_account (id, user_id, account_id, provider_id, password)
       values ($1, $2, $3, 'credential', 'hash')`,
      [uuidv7(), userId, userId],
    );
    // Re-run the backfill statement from the migration. It is
    // idempotent and scoped to null-issuer credential rows.
    await admin.query(
      `update ba_account set issuer = 'local:credential'
        where provider_id = 'credential' and issuer is null`,
    );
    const r = await admin.query<{ issuer: string }>(
      `select issuer from ba_account where user_id = $1 and provider_id = 'credential'`,
      [userId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.issuer).toBe("local:credential");
  });
});
