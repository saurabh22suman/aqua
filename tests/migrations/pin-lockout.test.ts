import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";

// Slice 2a — per-account PIN lockout.
//
// Why the columns live on `users` and not a separate
// `pin_attempts` table: a per-account counter is naturally a
// property of the identity (the user). A separate table adds
// rows for every existing user on day one and offers no extra
// capability. The credentials service in slice 3 reads/writes
// these columns under withPlatform().
//
// Migration file naming: db/migrations/20260912000000_pin_lockout.sql.
// The check:migrations script (run in CI) catches numbering and
// filename drift before the DB is touched.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

afterAll(async () => {
  await admin.end();
});

// We exercise the default values by inserting a throwaway user
// and rolling back. The user has no tenant, no membership, no
// ba_user link — it's a pure schema-shape test of the new
// columns. The throwaway's phone has a unique UUIDv7 tail so it
// never collides with the seed or other tests.
async function insertThrowawayUser(): Promise<string> {
  const userId = uuidv7();
  await admin.query("begin");
  try {
    await admin.query(
      "insert into users (id, phone) values ($1, $2)",
      [userId, `+91plt${userId.replace(/-/g, "").slice(0, 8)}`],
    );
    return userId;
  } catch (err) {
    await admin.query("rollback");
    throw err;
  }
}

async function cleanup(userId: string): Promise<void> {
  await admin.query("commit");
  await admin.query("delete from users where id = $1", [userId]);
}

describe("pin-lockout migration: 20260912000000_pin_lockout.sql", () => {
  it("exists with the expected filename and forward-only shape", () => {
    const sql = readFileSync(
      "db/migrations/20260912000000_pin_lockout.sql",
      "utf8",
    );
    // Pure add-column migration — no data backfill, no destructive
    // ops. Guard against someone turning this into a destructive
    // migration on the live users table (CLAUDE.md: "Never edit
    // an applied migration. Add a new one.").
    expect(sql).toMatch(/alter\s+table\s+users/i);
    expect(sql).toMatch(/add\s+column\s+failed_pin_attempts/i);
    expect(sql).toMatch(/add\s+column\s+pin_locked_until/i);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/delete\s+from\s+users/i);
  });

  it("adds failed_pin_attempts (integer, not null, default 0) to users", async () => {
    const rows = await admin.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'users'
          and column_name = 'failed_pin_attempts'`,
    );
    expect(rows.rows).toHaveLength(1);
    const c = rows.rows[0]!;
    expect(c.data_type).toBe("integer");
    expect(c.is_nullable).toBe("NO");
    expect(c.column_default).toBe("0");
  });

  it("adds pin_locked_until (timestamptz, nullable) to users", async () => {
    const rows = await admin.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'users'
          and column_name = 'pin_locked_until'`,
    );
    expect(rows.rows).toHaveLength(1);
    const c = rows.rows[0]!;
    expect(c.data_type).toBe("timestamp with time zone");
    expect(c.is_nullable).toBe("YES");
    expect(c.column_default).toBeNull();
  });

  it("a freshly inserted user gets failed_pin_attempts=0 and pin_locked_until=null", async () => {
    const userId = await insertThrowawayUser();
    try {
      const r = await admin.query<{
        failed_pin_attempts: number;
        pin_locked_until: Date | null;
      }>(
        `select failed_pin_attempts, pin_locked_until from users where id = $1`,
        [userId],
      );
      expect(r.rows[0]?.failed_pin_attempts).toBe(0);
      expect(r.rows[0]?.pin_locked_until).toBeNull();
    } finally {
      await cleanup(userId);
    }
  });

  it("failed_pin_attempts is settable to a positive integer and the lock timestamp can be set/cleared", async () => {
    const userId = await insertThrowawayUser();
    try {
      const until = new Date("2030-01-01T00:00:00Z");
      await admin.query(
        `update users
            set failed_pin_attempts = 5, pin_locked_until = $2
          where id = $1`,
        [userId, until],
      );
      const r = await admin.query<{
        failed_pin_attempts: number;
        pin_locked_until: Date;
      }>(
        `select failed_pin_attempts, pin_locked_until from users where id = $1`,
        [userId],
      );
      expect(r.rows[0]?.failed_pin_attempts).toBe(5);
      expect(new Date(r.rows[0]!.pin_locked_until).toISOString()).toBe(
        "2030-01-01T00:00:00.000Z",
      );
    } finally {
      await cleanup(userId);
    }
  });
});
