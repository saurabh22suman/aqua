import { afterAll, beforeAll, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { execFileSync } from "node:child_process";

let container: StartedPostgreSqlContainer;
let client: Client;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const env: NodeJS.ProcessEnv = { ...process.env, AQUA_NO_DOTENV: "1", NODE_ENV: "test",
    DATABASE_URL: `postgresql://app_login:first-deploy-test@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
    MIGRATION_DATABASE_URL: container.getConnectionUri(), APP_LOGIN_PASSWORD: "first-deploy-test" };
  // Exactly one real deployment, not reset followed by another bootstrap.
  execFileSync("pnpm", ["db:deploy"], { env, timeout: 90_000, stdio: "pipe" });
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
}, 120_000);
afterAll(async () => { await client?.end(); await container?.stop(); });

it("restricts new append-only tables and their partitions on the first deploy", async () => {
  const { rows: [grants] } = await client.query(`select
    has_table_privilege('app_user','announcements','UPDATE') as announcement_update,
    has_table_privilege('app_user','announcements','DELETE') as announcement_delete,
    has_table_privilege('app_user','notifications','DELETE') as notification_delete,
    has_table_privilege('app_user','notifications','UPDATE') as notification_read_state`);
  expect(grants).toEqual({ announcement_update: false, announcement_delete: false,
    notification_delete: false, notification_read_state: true });
  const { rows } = await client.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and (c.relname in ('account_entries','activity_events','audit_log') or
      c.oid in (select inhrelid from pg_inherits where inhparent in ('audit_log'::regclass,'activity_events'::regclass)))
    and (has_table_privilege('app_user',c.oid,'UPDATE') or has_table_privilege('app_user',c.oid,'DELETE'))`);
  expect(rows).toEqual([]);
});
