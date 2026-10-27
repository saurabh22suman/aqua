import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { runDisposableRestoreDrill } from "@/scripts/lib/disposable-restore/drill";
import { dumpDatabase, restoreArchive } from "@/scripts/lib/disposable-restore/dump";
import {
  createDrillContainer,
  listDrillContainers,
  mintDrillIdentity,
  removeDrillContainer,
} from "@/scripts/lib/disposable-restore/lifecycle";
import { assertDisposableTarget, assertDistinctTargets, type DisposableTargetRole } from "@/scripts/lib/disposable-restore/target";
import { buildContainerName } from "@/scripts/lib/disposable-restore/containers";
import { provisionDestinationRoles, provisionSourceDatabase } from "@/scripts/lib/disposable-restore/provision";

// B6 — the drill's negative cases.
//
// These are the cases that make the drill worth running. A restore
// tool that only ever succeeds proves nothing about the operator's
// worst day.
//
//   1. a corrupt archive must fail BEFORE anything is written;
//   2. an empty archive must fail;
//   3. a restore over a database that already holds the data must
//      fail, and must not destroy what is there;
//   4. a failed drill must remove every container it created;
//   5. the drill must never accept a target it did not create;
//   6. a container that was started but never became ready must be
//      removed by the code that started it, not left running.

const drillContainers: string[] = [];

afterAll(async () => {
  for (const name of drillContainers) {
    await removeDrillContainer(name).catch(() => {});
  }
}, 120_000);

/**
 * Removes ONE container by its exact name. The drill's own removal
 * helper refuses any name outside the drill namespace, which is
 * correct for the production path — but a regression test has to be
 * able to clean up after a container the buggy code leaked under a
 * name it should never have used. Exact name only: never a label
 * sweep, which would take another run's containers with it.
 */
function forceRemoveExact(containerName: string): void {
  try {
    execFileSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  } catch {
    // Already gone.
  }
}

/**
 * Runs a drill that is expected to fail, and returns the EXACT
 * container names that invocation created.
 *
 * The drill mints its own identities, so the test cannot know their
 * names unless it supplies them. Injecting the identity factory is
 * what makes "this invocation leaked nothing" an assertion about THIS
 * drill's containers — rather than about the host's whole inventory of
 * drill containers, which another lane running its own drill at the
 * same moment changes without either drill leaking anything.
 */
async function runFailingDrill(
  options: Parameters<typeof runDisposableRestoreDrill>[0],
): Promise<{ ownContainers: string[]; error: unknown }> {
  const ownContainers: string[] = [];
  const identityFactory = (role: DisposableTargetRole) => {
    const identity = mintDrillIdentity();
    ownContainers.push(buildContainerName(identity, role));
    return identity;
  };

  let error: unknown;
  try {
    await runDisposableRestoreDrill({ ...options, identityFactory });
  } catch (err) {
    error = err;
  }
  return { ownContainers, error };
}

describe("a corrupt archive is refused before anything is written", () => {
  it("fails the drill and removes every container it created", async () => {
    const { ownContainers, error } = await runFailingDrill({
      sourceDump: new TextEncoder().encode(
        "PGDMP this is not a real archive, it is truncated",
      ),
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /could not read|end of file|not in pg_dump custom format/i,
    );

    // The drill removes exactly what it created — it does not leave a
    // published port and a Postgres instance behind on failure. The
    // assertion is about THESE containers: another lane's drill
    // containers are none of this drill's business.
    expect(ownContainers).toHaveLength(2);
    for (const name of ownContainers) {
      expect(
        listDrillContainers(),
        `the failed drill must have removed ${name}`,
      ).not.toContain(name);
    }
  }, 600_000);

  it("fails the drill for an empty archive", async () => {
    const { ownContainers, error } = await runFailingDrill({
      sourceDump: new Uint8Array(0),
    });

    expect((error as Error).message).toMatch(/empty/i);
    expect(ownContainers).toHaveLength(2);
    for (const name of ownContainers) {
      expect(
        listDrillContainers(),
        `the failed drill must have removed ${name}`,
      ).not.toContain(name);
    }
  }, 600_000);

  it("fails the drill for bytes that are not an archive at all", async () => {
    const { ownContainers, error } = await runFailingDrill({
      sourceDump: new TextEncoder().encode("this is plain text, not a dump"),
    });

    expect((error as Error).message).toMatch(/PGDMP/i);
    expect(ownContainers).toHaveLength(2);
    for (const name of ownContainers) {
      expect(
        listDrillContainers(),
        `the failed drill must have removed ${name}`,
      ).not.toContain(name);
    }
  }, 600_000);

  it("leaves another lane's drill containers alone", async () => {
    // A container that carries the drill label but was NOT created by
    // this invocation — exactly what another lane's drill looks like
    // from here. The failed drill must remove its own two and leave
    // this one running: cleanup that swept the label would take another
    // session's work with it.
    const otherLane = await createDrillContainer({
      identity: mintDrillIdentity(),
      role: "source",
    });
    drillContainers.push(otherLane.containerName);

    const { ownContainers, error } = await runFailingDrill({
      sourceDump: new TextEncoder().encode("not a dump at all"),
    });

    expect((error as Error).message).toMatch(/PGDMP/i);
    for (const name of ownContainers) {
      expect(listDrillContainers()).not.toContain(name);
    }
    expect(
      listDrillContainers(),
      "the drill must not remove a container it did not create",
    ).toContain(otherLane.containerName);
  }, 600_000);
});

describe("a restore never overwrites a database that already holds the data", () => {
  let sourceName = "";
  let destinationName = "";
  let sourceUri = "";
  let destinationUri = "";

  beforeAll(async () => {
    const source = await createDrillContainer({
      identity: mintDrillIdentity(),
      role: "source",
    });
    const destination = await createDrillContainer({
      identity: mintDrillIdentity(),
      role: "destination",
    });
    drillContainers.push(source.containerName, destination.containerName);
    sourceName = source.containerName;
    destinationName = destination.containerName;
    sourceUri = source.adminUri;
    destinationUri = destination.adminUri;

    await provisionSourceDatabase(source);
    // The destination gets ROLES only — no migrations. The schema must
    // arrive with the archive, exactly as in the real drill.
    await provisionDestinationRoles(destination);
  }, 600_000);

  it("refuses a second restore over the same database, and keeps the data", async () => {
    const source = {
      containerName: sourceName,
      adminUri: sourceUri,
      identity: "",
      role: "source" as const,
      host: "127.0.0.1",
      port: 0,
      database: "aqua_drill",
      appUri: "",
      appPassword: "",
    };
    const destination = {
      containerName: destinationName,
      adminUri: destinationUri,
      identity: "",
      role: "destination" as const,
      host: "127.0.0.1",
      port: 0,
      database: "aqua_drill",
      appUri: "",
      appPassword: "",
    };

    const archive = dumpDatabase(source as never);
    const first = new Pool({ connectionString: destinationUri });
    try {
      // The first restore creates the schema.
      restoreArchive(destination as never, archive);
      await first.query("create table probe_keep (id int)");

      // The second restore must refuse: the objects already exist.
      expect(() => restoreArchive(destination as never, archive)).toThrow(
        /pg_restore failed/i,
      );

      // And the data that was already there is still there.
      const { rows } = await first.query<{ count: string }>(
        "select count(*)::text as count from probe_keep",
      );
      expect(rows[0]?.count).toBe("0");
    } finally {
      await first.end();
    }
  }, 600_000);
});

describe("a container that was started but never became ready is removed, not leaked", () => {
  it("removes the container it started when the readiness check fails", async () => {
    const identity = mintDrillIdentity();
    const containerName = `${identity}-source`;

    await expect(
      createDrillContainer(
        { identity, role: "source" },
        {
          readinessProbe: async () => {
            throw new Error("readiness probe failed on purpose");
          },
        },
      ),
    ).rejects.toThrow(/readiness probe failed on purpose/);

    // Docker had already started this container before the probe
    // failed. It must not be left running: a leaked Postgres instance
    // holds a published port for the rest of the machine's life, and
    // the drill's own cleanup list never learned the name.
    expect(listDrillContainers()).not.toContain(containerName);

    forceRemoveExact(containerName);
  }, 300_000);

  it("surfaces the readiness failure itself, not a cleanup failure", async () => {
    const identity = mintDrillIdentity();
    const containerName = `${identity}-destination`;
    let caught: Error | undefined;

    try {
      await createDrillContainer(
        { identity, role: "destination" },
        {
          readinessProbe: async () => {
            throw new Error("readiness probe failed on purpose");
          },
        },
      );
    } catch (err) {
      caught = err instanceof Error ? err : undefined;
    }

    // The primary error is the one that explains what went wrong. A
    // cleanup failure must never replace it — the operator needs the
    // real cause, and a cleanup failure on top of it would only
    // obscure it.
    expect(caught?.message).toMatch(/readiness probe failed on purpose/);
    expect(caught?.message).not.toMatch(/Could not remove/i);

    forceRemoveExact(containerName);
  }, 300_000);

  it("creates nothing at all for an identity that is not a drill identity", async () => {
    const identity = "aqua-production-db";
    const containerName = `${identity}-source`;

    await expect(
      createDrillContainer({ identity, role: "source" }),
    ).rejects.toThrow(/production/i);

    // The synthetic-only guard must hold before Docker is asked for
    // anything: a container named after a production environment must
    // never come into existence, even briefly.
    expect(listDrillContainers()).not.toContain(containerName);

    forceRemoveExact(containerName);
  }, 300_000);
});

describe("the drill only ever restores into a database it created", () => {
  it("refuses a target whose identity is not a minted drill identity", () => {
    expect(() =>
      assertDisposableTarget({
        identity: "aqua-production-db",
        role: "destination",
        host: "127.0.0.1",
        port: 40001,
        database: "aqua_drill",
        containerName: "aqua-drill-0a1b2c3d4e5f-destination",
        adminUri: "postgresql://aqua:pw@127.0.0.1:40001/aqua_drill",
        appUri: "postgresql://app_login:pw@127.0.0.1:40001/aqua_drill",
        appPassword: "pw",
      }),
    ).toThrow(/production/i);
  });

  it("refuses a source and a destination that are the same database", () => {
    const target = {
      identity: "aqua-drill-0a1b2c3d4e5f",
      role: "source" as const,
      host: "127.0.0.1",
      port: 40001,
      database: "aqua_drill",
      containerName: "aqua-drill-0a1b2c3d4e5f-source",
      adminUri: "postgresql://aqua:pw@127.0.0.1:40001/aqua_drill",
      appUri: "postgresql://app_login:pw@127.0.0.1:40001/aqua_drill",
      appPassword: "pw",
    };
    expect(() =>
      assertDistinctTargets(target, { ...target, role: "destination" }),
    ).toThrow(/different/i);
  });

  it("refuses a target on a remote host", () => {
    expect(() =>
      assertDisposableTarget({
        identity: "aqua-drill-0a1b2c3d4e5f",
        role: "destination",
        host: "db.internal",
        port: 40001,
        database: "aqua_drill",
        containerName: "aqua-drill-0a1b2c3d4e5f-destination",
        adminUri: "postgresql://aqua:pw@db.internal:40001/aqua_drill",
        appUri: "postgresql://app_login:pw@db.internal:40001/aqua_drill",
        appPassword: "pw",
      }),
    ).toThrow(/loopback/i);
  });
});
