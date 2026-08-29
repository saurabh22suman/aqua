import { sql } from "drizzle-orm";
import { PgBoss, fromDrizzle } from "pg-boss";
import { db } from "./client";
import { withPlatform } from "./scope";

// pg-boss needs a role-aware connection. db/client.ts's pool already runs
// `set role app_user` on every connection (its onConnect hook) — routing
// pg-boss's queries through drizzle's own connection reuses that for
// free. A raw connectionString would connect as app_login directly
// (NOINHERIT: no privileges without an explicit SET ROLE pg-boss has no
// reason to know about), and every query would fail with "permission
// denied for schema pgboss" — reproduced this for real before adding
// this adapter.
//
// pg-boss's own queries (schema checks, schedule/work polling) are
// infrastructure-level, not tenant data — exactly what withPlatform()
// is for. Without it, db/client.ts's dev/test scope guard correctly
// flags every one of them as an unscoped query (also reproduced for
// real) — the guard doesn't know pg-boss's queries are legitimately
// unscoped, only that nothing declared a scope.
//
// The adapter only implements executeSql, not listen() — LISTEN/NOTIFY
// instant wake-up falls back to polling, which is fine here: nothing
// this app schedules needs sub-second latency (nightly cron, see
// worker/index.ts).
export function createAppScopedBoss(): PgBoss {
  const adapter = fromDrizzle(db, sql);
  return new PgBoss({
    db: {
      executeSql: (text, values) => withPlatform(() => adapter.executeSql(text, values)),
    },
  });
}
