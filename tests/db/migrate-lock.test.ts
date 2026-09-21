import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";

// PR1-C9 — two runners on the same fresh database must not race:
// the advisory lock serialises them, so one applies every migration
// and the other finds them all applied (no _migrations primary-key
// collision, no half-applied state).

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const FILE_COUNT = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith(".sql"),
).length;

let container: StartedPostgreSqlContainer;
let admin: Pool;
let uri: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  uri = container.getConnectionUri();
  await bootstrapRoles(uri, "migrate-lock-pw");
  admin = new Pool({ connectionString: uri });
}, 240_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe("runMigrations advisory lock (PR1-C9)", () => {
  it("serialises two concurrent runners and applies every file exactly once", async () => {
    const results = await Promise.all([runMigrations(uri), runMigrations(uri)]);
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(FILE_COUNT);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from _migrations",
    );
    expect(Number(rows[0]!.count)).toBe(FILE_COUNT);
  }, 240_000);
});
