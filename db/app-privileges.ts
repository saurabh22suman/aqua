import { Client } from "pg";

// Apply exact append-only grants after new tables exist, including partitions.
export async function restrictAppPrivileges(client: Client): Promise<void> {
  for (const table of ["activity_events", "audit_log", "announcements", "account_entries", "platform_audit_log", "absence_alerts", "gate_access_events"]) {
    await client.query(`do $$ declare part regclass; begin
      if to_regclass('public.${table}') is not null then
        revoke update, delete on public.${table} from app_user;
        for part in select inhrelid::regclass from pg_inherits where inhparent='public.${table}'::regclass loop
          execute format('revoke update, delete on %s from app_user', part);
        end loop;
      end if; end $$`);
  }
  // F01 — durable intent history is mutable (prepared -> committed /
  // cancelled) but must never be deletable by the app role. This is a
  // DELETE-only revoke: do NOT add payment_intents to the append-only
  // UPDATE+DELETE loop above. bootstrapRoles runs before migrations (table
  // absent); reconcileAppPrivileges runs after migrate on db:deploy and
  // makes this effective. A bare db:migrate does not run this reconcile.
  await client.query(`do $$ begin if to_regclass('public.payment_intents') is not null then
    revoke delete on public.payment_intents from app_user; end if; end $$`);
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
