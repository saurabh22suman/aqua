// B6 — provisioning the two sides of the round trip.
//
// The SOURCE is provisioned exactly like a deployed database:
// roles first, then the forward-only SQL migrations, then the
// append-only grant restrictions (db/deploy.ts's order, which
// db/CLAUDE.md states as an invariant).
//
// The DESTINATION is provisioned the way the runbook in
// docs/deployment.md tells an operator to: roles are bootstrapped on
// the fresh target BEFORE pg_restore, and the target's own grant
// policy is re-applied AFTER the restore, because a dump taken with
// --no-privileges deliberately carries no GRANTs.
//
// The destination is NOT migrated. The schema must arrive with the
// dump, or the drill would be proving that migrations work, not that
// the backup does.

import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { reconcileAppPrivileges } from "@/db/app-privileges";
import type { DisposableTarget } from "./target";

/** Roles, then every forward-only migration, then the grant restrictions. */
export async function provisionSourceDatabase(
  target: DisposableTarget,
): Promise<void> {
  await bootstrapRoles(target.adminUri, target.appPassword);
  await runMigrations(target.adminUri);
  await reconcileAppPrivileges(target.adminUri);
}

/**
 * Bootstraps the application roles on the fresh restore target,
 * before any data is written into it. The roles must exist first
 * because the migrations' GRANT statements name app_user, and because
 * the restored policies name app_user as their role.
 */
export async function provisionDestinationRoles(
  target: DisposableTarget,
): Promise<void> {
  await bootstrapRoles(target.adminUri, target.appPassword);
}

/**
 * Re-applies the target's own grant policy after the restore. The
 * dump was taken with --no-privileges, so it carries no GRANTs; the
 * application role's access to the restored tables is established
 * here, by the same code that establishes it on a deployed database.
 */
export async function reconcileRestoredGrants(
  target: DisposableTarget,
): Promise<void> {
  await bootstrapRoles(target.adminUri, target.appPassword);
  await reconcileAppPrivileges(target.adminUri);
}
