// Privileged browser-fixture SETUP ONLY. Never imported by app, lib or components.
// Shared guards retain local disposable database and actual connection identity checks.
import type { Pool } from "pg";

type Guard = {
  runtime: URL;
  migration: URL;
  database: string;
};

/**
 * Refuse to touch anything that is not this lane's disposable test
 * database. Throws with every problem listed, so a misconfigured run
 * says exactly what is wrong instead of failing later on a write.
 */
export function assertDisposableTarget(): Guard {
  const problems: string[] = [];
  if (process.env.AQUA_HARNESS_TEST_DATABASE !== "disposable") {
    problems.push("AQUA_HARNESS_TEST_DATABASE must be 'disposable'");
  }
  if (process.env.AQUA_NO_DOTENV !== "1") {
    problems.push("AQUA_NO_DOTENV must be '1'");
  }
  let runtime: URL | null = null;
  let migration: URL | null = null;
  try {
    runtime = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    problems.push("DATABASE_URL is not a URL");
  }
  try {
    migration = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  } catch {
    problems.push("MIGRATION_DATABASE_URL is not a URL");
  }
  if (runtime && migration) {
    for (const [name, url] of [
      ["DATABASE_URL", runtime],
      ["MIGRATION_DATABASE_URL", migration],
    ] as const) {
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        problems.push(`${name} must point at a local host, not ${url.hostname}`);
      }
      if (!url.pathname.startsWith("/aqua_test_")) {
        problems.push(`${name} must point at an aqua_test_* database`);
      }
    }
    if (runtime.pathname !== migration.pathname) {
      problems.push("both URLs must name the SAME database");
    }
    if (!runtime.username.startsWith("app_login")) {
      problems.push("DATABASE_URL must use the app_login role");
    }
    if (!migration.username.startsWith("aqua")) {
      problems.push("MIGRATION_DATABASE_URL must use the aqua role");
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `refusing to seed a fixture: ${problems.join("; ")}. This fixture may only ` +
        `write to a lane's disposable test database.`,
    );
  }
  const database = decodeURIComponent((runtime as URL).pathname.slice(1));
  return { runtime: runtime as URL, migration: migration as URL, database };
}

/** Prove the session is what the URL claimed, before any write. */
export async function assertSession(
  client: Pool,
  database: string,
  expectedRoles: string[],
  label: string,
) {
  const result = await client.query<{ db: string; role: string }>(
    "select current_database() as db, current_user as role",
  );
  const row = result.rows[0]!;
  if (row.db !== database) {
    throw new Error(
      `${label} is connected to "${row.db}", not the disposable database "${database}"`,
    );
  }
  if (!expectedRoles.includes(row.role)) {
    throw new Error(
      `${label} runs as "${row.role}", expected one of ${expectedRoles.join(", ")}`,
    );
  }
  return row;
}

