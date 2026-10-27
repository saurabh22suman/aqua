// B6 — the disposable backup/restore drill.
//
// One run proves the whole chain on two throwaway PostgreSQL 16
// databases:
//
//   source container            destination container
//   (roles + migrations)        (roles only, NO migrations)
//   + synthetic two-tenant data
//        |  pg_dump --format=custom --no-owner --no-privileges
//        v
//   pg_restore --list  ->  is the archive even readable?
//        |
//        v
//   pg_restore --no-owner --no-privileges
//        |
//        v
//   re-apply the target's own grants
//        |
//        v
//   verify: migrations, exact rows, exact paise, grants, RLS,
//           role attributes, and two-tenant isolation
//
// The destination is never migrated. If the schema arrives, it
// arrived with the dump.
//
// Nothing outside this process is touched: both containers are created
// here and removed here, on loopback, on ports Docker assigns.

import {
  assertDistinctTargets,
  assertDisposableTarget,
  type DisposableTarget,
} from "./target";
import {
  createDrillContainer,
  mintDrillIdentity,
  removeDrillContainer,
} from "./lifecycle";
import {
  assertArchiveIsRestorableInContainer,
  dumpDatabase,
  listArchive,
  restoreArchive,
} from "./dump";
import { assertDumpBytesLookValid } from "./archive";
import { seedSyntheticFixture, type SyntheticFixture } from "./seed";
import {
  assertVerificationPassed,
  verifyRestoredDatabase,
  type VerificationSummary,
} from "./verify";

export type DrillOptions = {
  /**
   * Leave the two containers running after the drill so an operator
   * can inspect them. Off by default: the drill cleans up exactly
   * what it created.
   */
  preserve?: boolean;
  /**
   * Which target the ambient application-pool environment points at.
   * The provisioning code loads lib/env.ts, which validates
   * DATABASE_URL, so the drill points it at a real drill database
   * rather than at whatever the operator's shell happens to hold.
   */
  appPoolTarget?: "source" | "destination";
  /**
   * Restore THIS archive instead of dumping the source database. The
   * drill still seeds the source, provisions the destination and
   * verifies the result — but the bytes that arrive are the ones
   * given here. It exists so the negative cases (a corrupt archive, an
   * empty archive) can be exercised against the real restore path.
   */
  sourceDump?: Uint8Array;
  /** Progress callback — every message is safe to print. */
  onProgress?: (message: string) => void;
};

export type DrillResult = {
  source: DisposableTarget;
  destination: DisposableTarget;
  dumpBytes: number;
  archiveListing: string;
  summary: VerificationSummary;
  fixture: SyntheticFixture;
  createdContainerNames: string[];
  preserved: boolean;
};

export async function runDisposableRestoreDrill(
  options: DrillOptions = {},
): Promise<DrillResult> {
  const report = options.onProgress ?? (() => {});
  const created: string[] = [];

  const sourceIdentity = mintDrillIdentity();
  const destinationIdentity = mintDrillIdentity();

  try {
    report("Creating the disposable source container...");
    const source = await createDrillContainer({
      identity: sourceIdentity,
      role: "source",
    });
    created.push(source.containerName);

    report("Creating the disposable destination container...");
    const destination = await createDrillContainer({
      identity: destinationIdentity,
      role: "destination",
    });
    created.push(destination.containerName);

    assertDisposableTarget(source);
    assertDisposableTarget(destination);
    assertDistinctTargets(source, destination);

    // Point the ambient app-pool environment at a real drill database
    // BEFORE anything imports lib/env.ts.
    const appPoolTarget =
      options.appPoolTarget === "destination" ? destination : source;
    process.env.DATABASE_URL = appPoolTarget.appUri;
    process.env.APP_LOGIN_PASSWORD = appPoolTarget.appPassword;

    const { provisionSourceDatabase, provisionDestinationRoles, reconcileRestoredGrants } =
      await import("./provision");

    report("Provisioning the source database (roles, then migrations)...");
    await provisionSourceDatabase(source);

    report("Seeding the synthetic two-tenant fixture...");
    const fixture = await seedSyntheticFixture(source.adminUri);

    let dump: Uint8Array;
    if (options.sourceDump) {
      report(`Using the supplied archive (${options.sourceDump.byteLength} bytes)...`);
      dump = options.sourceDump;
      // The supplied bytes get the same shape check as a freshly taken
      // dump, so an empty or non-archive is refused before anything is
      // written to the destination.
      assertDumpBytesLookValid(dump);
    } else {
      report("Taking the custom-format dump...");
      dump = dumpDatabase(source);
      report(`Dump captured: ${dump.byteLength} bytes.`);
    }

    report("Checking the archive is readable (pg_restore --list)...");
    const listing = listArchive(source, dump);
    assertArchiveIsRestorableInContainer(source, dump);

    report("Bootstrapping the application roles on the restore target...");
    await provisionDestinationRoles(destination);

    report("Restoring the archive into the destination...");
    restoreArchive(destination, dump);

    report("Re-applying the target's own grants...");
    await reconcileRestoredGrants(destination);

    report("Verifying the restored database...");
    const summary = await verifyRestoredDatabase(source, destination, fixture);
    assertVerificationPassed(summary);

    const preserved = options.preserve === true;
    if (!preserved) {
      report("Removing the disposable containers...");
      await removeCreated(created);
    }

    return {
      source,
      destination,
      dumpBytes: dump.byteLength,
      archiveListing: listing.stdout,
      summary,
      fixture,
      createdContainerNames: created,
      preserved,
    };
  } catch (error) {
    // A FAILED drill always cleans up, even when the caller asked to
    // preserve the containers: a failed run has nothing to inspect,
    // and a leaked container is a leaked Postgres instance holding a
    // published port. The names are in the message so the failure can
    // still be diagnosed.
    const names = created.join(", ");
    await removeCreated(created).catch(() => {});
    throw new Error(
      `The disposable restore drill failed${
        names ? ` (containers it created and removed: ${names})` : ""
      }: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Removes the containers this run created, one by one. A container
 * that is already gone is not an error; a container outside the drill
 * namespace is refused by the removal helper itself.
 */
export async function removeCreated(containerNames: string[]): Promise<void> {
  for (const name of containerNames) {
    await removeDrillContainer(name);
  }
}
