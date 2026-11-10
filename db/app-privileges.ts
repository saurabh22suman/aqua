import { Client } from "pg";

// Apply exact append-only grants after new tables exist, including partitions.
export async function restrictAppPrivileges(client: Client): Promise<void> {
  for (const table of ["activity_events", "audit_log", "announcements", "account_entries", "platform_audit_log", "absence_alerts", "gate_access_events", "booking_check_ins"]) {
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
  // 2026-11-09 member sign-in — the DURABLE privileges for the four new
  // self-service tables and for the two link tables.
  //
  // A REVOKE WRITTEN IN A MIGRATION IS NOT DURABLE: bootstrapRoles grants
  // blanket DML on every table in schema public (db/bootstrap-roles.ts:45-49)
  // and ALTER DEFAULT PRIVILEGES re-applies it (:66-77), so the next
  // `pnpm db:deploy` re-grants what a migration revoked. This function is
  // the repository's durable mechanism: it runs inside bootstrapRoles
  // (which happens BEFORE migrations) AND inside reconcileAppPrivileges
  // (which runs AFTER migrate on db:deploy), so the guarantee survives a
  // re-bootstrap.
  //
  // WHAT IS REVOKED, AND WHY EACH ONE
  //   self_service_link_uses      - revoke update, delete. A consumed
  //                                  activation jti is a record of what
  //                                  happened; it is append-only for the
  //                                  app role, exactly like audit_log.
  //   self_service_session_links  - revoke update, delete. The binding set
  //                                  of a session is a record, not editable
  //                                  state; rewriting it would change what
  //                                  the session is bound to after the
  //                                  fact.
  //   self_service_sessions       - revoke delete only. The door touches
  //                                  last_seen_at and the revocation path
  //                                  sets revoked_at, so UPDATE must stay;
  //                                  but a DELETED session row would take
  //                                  its binding set and its trail with
  //                                  it. A revocation is an UPDATE.
  //   self_service_login_attempts - revoke delete only. The counter is a
  //                                  counter and needs UPDATE; but a
  //                                  DELETED budget row is a fresh budget,
  //                                  so the delete vector is closed.
  //   member_account_links,
  //   guardian_child_links        - revoke delete. A link is REVOKED
  //                                  (status -> 'revoked'), never deleted:
  //                                  the row is the club's record of the
  //                                  pairing and of the attestation, and
  //                                  the session binding ledger's foreign
  //                                  keys point at it. A deleted link row
  //                                  also silently unbinds a live session,
  //                                  and the session row survives with
  //                                  revoked_at is null.
  //
  // WHAT IS NOT REVOKED, AND WHY IT MATTERS
  //   UPDATE on self_service_login_attempts stays, because the throttle
  //   increments the counter. The consequence is that an app_user path
  //   inside a tenant scope can still RESET a counter by updating it. The
  //   reset is confined by RLS to the account's OWN club. Named residual
  //   R-3.
  //
  //   THE CASCADE IS NOT CLOSED BY ANY REVOKE HERE. Referential actions
  //   run as the OWNER of the referencing table, so a hard delete of a
  //   users or tenants row still cascades the session rows (and their
  //   revocation records) away, and a hard delete of a member row still
  //   cascades its link rows. Closing that is a human gate (the review's
  //   FA-6 / F-11 / SX-3): the mechanism would be a BEFORE DELETE guard
  //   that refuses the removal, which would also refuse a hard delete of
  //   an account that a live session binds. Named residual R-6.
  //
  //   NOTE: a bare `pnpm db:migrate` does NOT run reconcileAppPrivileges,
  //   so these revokes are only effective after `pnpm db:deploy`. Named
  //   residual R-9.
  await client.query(`do $$ begin
    if to_regclass('public.self_service_link_uses') is not null then
      revoke update, delete on public.self_service_link_uses from app_user;
    end if;
    if to_regclass('public.self_service_session_links') is not null then
      revoke update, delete on public.self_service_session_links from app_user;
    end if;
    if to_regclass('public.self_service_sessions') is not null then
      revoke delete on public.self_service_sessions from app_user;
    end if;
    if to_regclass('public.self_service_login_attempts') is not null then
      revoke delete on public.self_service_login_attempts from app_user;
    end if;
    if to_regclass('public.member_account_links') is not null then
      revoke delete on public.member_account_links from app_user;
    end if;
    if to_regclass('public.guardian_child_links') is not null then
      revoke delete on public.guardian_child_links from app_user;
    end if;
  end $$`);
  // Showcase rows are append-only; deployment reconciliation must retain this.
  await client.query(`do $$ begin if to_regclass('public.showcase_decisions_seq') is not null then
    revoke all on sequence public.showcase_decisions_seq from app_user; end if; end $$`);
  await client.query(`do $$ begin if to_regclass('public.showcase_decisions') is not null then
    revoke update, delete on public.showcase_decisions from app_user; end if; end $$`);
  await client.query(`do $$ begin if to_regclass('public.showcase_profiles') is not null then
    revoke update, delete on public.showcase_profiles from app_user; end if; end $$`);

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
