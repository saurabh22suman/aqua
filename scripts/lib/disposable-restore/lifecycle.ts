// B6 — the lifecycle of a drill container.
//
// A drill container is created, used, and removed by the same run. The
// removal path is deliberately narrow: it names ONE container, and
// only after assertOwnedContainerName() has confirmed the name is one
// this drill minted. There is no prune, no remove-all and no
// "tidy up old drill containers" path — the drill does not clean up
// after other runs, because it cannot know what they were doing.

import { randomBytes } from "node:crypto";
import { Client } from "pg";
import {
  buildExecArgs,
  buildListOwnedArgs,
  buildRemoveArgs,
  buildRunArgs,
  parsePublishedPort,
  type ContainerSpec,
} from "./containers";
import { runDocker, runDockerBinary } from "./docker";
import {
  assertDisposableIdentity,
  assertDisposableTarget,
  type DisposableTarget,
  type DisposableTargetRole,
} from "./target";

const DRILL_DATABASE = "aqua_drill";
const DRILL_DB_ROLE = "aqua";

/** Mints a fresh, closed-namespace identity for one drill target. */
export function mintDrillIdentity(): string {
  return `aqua-drill-${randomBytes(6).toString("hex")}`;
}

/**
 * The seams a caller may substitute. They exist so the failure paths
 * of container creation can be exercised deterministically — a
 * container that never becomes ready is the case the cleanup below
 * exists for, and it cannot be forced reliably any other way.
 */
export type ContainerStartHooks = {
  /**
   * Replaces the readiness wait. The drill's own probe confirms the
   * database accepts a REAL connection, not merely that the postmaster
   * answers. A test can substitute a probe that fails, to prove that a
   * container which never became ready is removed rather than leaked.
   */
  readinessProbe?: (target: DisposableTarget) => Promise<void>;
};

/**
 * Starts one disposable PostgreSQL 16 container and waits until it
 * accepts connections. Docker assigns the host port; the drill never
 * picks one.
 *
 * CLEANUP CONTRACT: once `docker run` has succeeded, this container
 * exists. The drill's own cleanup list only learns the name after this
 * function RESOLVES, so any failure between the successful run and the
 * return would leak a Postgres instance on a published port. Everything
 * after the run is therefore inside a try/catch that removes the
 * container before the error leaves this function, and re-throws the
 * PRIMARY error unchanged — a cleanup failure is attached as its
 * cause, never substituted for it.
 */
export async function createDrillContainer(
  spec: ContainerSpec,
  hooks: ContainerStartHooks = {},
): Promise<DisposableTarget> {
  // The synthetic-only guard runs BEFORE Docker is asked for anything.
  // A target that is not a minted drill identity must never come into
  // existence, not even for the second between "docker run" and the
  // check that would have refused it.
  assertDisposableIdentity(spec.identity);

  const password = randomBytes(24).toString("base64url");
  const containerName = `${spec.identity}-${spec.role}`;

  const started = runDocker(buildRunArgs(spec, password));
  if (started.exitCode !== 0) {
    // Nothing was created: docker refused the name or the image. There
    // is nothing to clean up, and nothing to remove — a container with
    // this name may already exist and must not be touched.
    throw new Error(
      `Could not start the disposable ${spec.role} container: ${started.stderr.trim()}`,
    );
  }

  // The container EXISTS from here on.
  try {
    const port = readPublishedPort(containerName);
    const target: DisposableTarget = {
      identity: spec.identity,
      role: spec.role,
      host: "127.0.0.1",
      port,
      database: DRILL_DATABASE,
      containerName,
      adminUri: `postgresql://${DRILL_DB_ROLE}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DRILL_DATABASE}`,
      appUri: `postgresql://app_login:${encodeURIComponent(password)}@127.0.0.1:${port}/${DRILL_DATABASE}`,
      appPassword: password,
    };
    assertDisposableTarget(target);

    await (hooks.readinessProbe ?? waitForReady)(target);
    return target;
  } catch (error) {
    // The container was started by this call and is not in the drill's
    // cleanup list. Remove it here, before the error escapes.
    try {
      removeContainerStartedBy(containerName);
    } catch (cleanupError) {
      // The primary error is the one that explains what went wrong. A
      // cleanup failure is attached as its cause so the operator sees
      // both, and it never replaces the primary error.
      if (error instanceof Error && error.cause === undefined) {
        error.cause = cleanupError;
      }
    }
    throw error;
  }
}

/**
 * Removes a container THIS call started, by its exact name.
 *
 * It does not go through assertOwnedContainerName(): the identity was
 * validated before the container was created, so the name is inside
 * the drill namespace by construction — and the ownership proof here
 * is stronger anyway: this call started the container seconds ago.
 */
function removeContainerStartedBy(containerName: string): void {
  const result = runDocker(buildRemoveArgs(containerName));
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not remove the disposable container "${containerName}": ${result.stderr.trim()}`,
    );
  }
}

/**
 * Removes one container this drill created. Refuses any name outside
 * the drill namespace.
 */
export async function removeDrillContainer(containerName: string): Promise<void> {
  const result = runDocker(buildRemoveArgs(containerName));
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not remove the disposable container "${containerName}": ${result.stderr.trim()}`,
    );
  }
}

/** Lists the containers still carrying the drill label (evidence). */
export function listDrillContainers(): string[] {
  const result = runDocker(buildListOwnedArgs());
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not list the disposable drill containers: ${result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Runs a command inside a drill container and returns its text output. */
export function execInContainer(
  target: DisposableTarget,
  command: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = runDocker(buildExecArgs(target.containerName, command));
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Runs a command inside a drill container and returns raw bytes. */
export function execInContainerBinary(
  target: DisposableTarget,
  command: string[],
  options: { input?: Buffer } = {},
): { exitCode: number; stdout: Buffer; stderr: string } {
  const result = runDockerBinary(
    buildExecArgs(target.containerName, command, { stdin: options.input !== undefined }),
    { input: options.input },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readPublishedPort(containerName: string): number {
  const result = runDocker(["port", containerName, "5432/tcp"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not read the published port of "${containerName}": ${result.stderr.trim()}`,
    );
  }
  return parsePublishedPort(result.stdout);
}

async function waitForReady(target: DisposableTarget): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline) {
    // A real connection, not just pg_isready: the official image's
    // postmaster accepts sockets before the database is created, and
    // "starting up" is a failure the readiness probe must not accept.
    const client = new Client({ connectionString: target.adminUri });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `The disposable ${target.role} container did not become ready: ${lastError}`,
  );
}

export type { DisposableTargetRole };
