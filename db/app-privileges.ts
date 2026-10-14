import { Client } from "pg";

// Apply exact append-only grants after new tables exist, including partitions.
export async function restrictAppPrivileges(client: Client): Promise<void> {
  for (const table of ["activity_events", "audit_log", "announcements", "account_entries"]) {
    await client.query(`do $$ declare part regclass; begin
      if to_regclass('public.${table}') is not null then
        revoke update, delete on public.${table} from app_user;
        for part in select inhrelid::regclass from pg_inherits where inhparent='public.${table}'::regclass loop
          execute format('revoke update, delete on %s from app_user', part);
        end loop;
      end if; end $$`);
  }
  await client.query(`do $$ begin if to_regclass('public.notifications') is not null then
    revoke delete on public.notifications from app_user; end if; end $$`);
}

export async function reconcileAppPrivileges(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('aqua-app-privileges'))");
    await restrictAppPrivileges(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { await client.end(); }
}
