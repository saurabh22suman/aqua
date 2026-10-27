// B6 — how the drill creates and destroys its own Postgres containers.
//
// Two properties matter more than anything else here:
//
//   1. The published host port is AUTO-ASSIGNED by Docker. The drill
//      never picks a port, so it can never collide with the harness
//      database, the dev database or another agent's container. The
//      publish specification is "127.0.0.1::5432" — an empty host
//      port, which is Docker's "give me a free one" form.
//
//   2. Cleanup names exactly ONE container, and only one this run
//      created. There is no prune, no remove-all, no "clean up stale
//      drill containers" — a drill that broadens its cleanup would
//      delete somebody else's work.
//
// The command arguments are built as pure functions so both properties
// are asserted directly (tests/backend-b6/backup-restore/
// containers.test.ts) rather than inferred from a running container.
//
// The POSTGRES_PASSWORD in the container's environment is a random
// throwaway generated for a disposable container. It is never a real
// credential, never printed, and never an argument to pg_dump or
// pg_restore: those connect over the container's local socket, which
// the official image trusts.

import type { DisposableTargetRole } from "./target";

export const DRILL_LABEL_KEY = "aqua.drill";
export const DRILL_LABEL_VALUE = "b6";
export const DRILL_IMAGE = "postgres:16";

/** Container names the drill owns, and only names the drill owns. */
export const DRILL_CONTAINER_NAME_PATTERN =
  /^aqua-drill-[0-9a-f]{12}-(source|destination)$/;

/** The role that owns the database inside every drill container. */
export const DRILL_DB_ROLE = "aqua";

/** The database inside every drill container. */
export const DRILL_DATABASE = "aqua_drill";

export type ContainerSpec = {
  identity: string;
  role: DisposableTargetRole;
  image?: string;
};

export function buildContainerName(
  identity: string,
  role: DisposableTargetRole,
): string {
  return `${identity}-${role}`;
}

export function buildRunArgs(spec: ContainerSpec, password: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    buildContainerName(spec.identity, spec.role),
    "--label",
    `${DRILL_LABEL_KEY}=${DRILL_LABEL_VALUE}`,
    "--label",
    `${DRILL_LABEL_KEY}.role=${spec.role}`,
    // Empty host port: Docker assigns a free one. The drill never
    // chooses a port, so it never collides with anything.
    "--publish",
    "127.0.0.1::5432",
    // tmpfs: the data directory disappears with the container.
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    `POSTGRES_USER=${DRILL_DB_ROLE}`,
    "--env",
    `POSTGRES_DB=${DRILL_DATABASE}`,
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    spec.image ?? DRILL_IMAGE,
  ];
}

export function buildExecArgs(
  containerName: string,
  command: string[],
  options: { stdin?: boolean } = {},
): string[] {
  const args = ["exec"];
  if (options.stdin) args.push("-i");
  args.push(containerName, ...command);
  return args;
}

export function parsePublishedPort(dockerPortOutput: string): number {
  const match = dockerPortOutput.match(/:(\d+)\s*$/m);
  if (!match) {
    throw new Error(
      `Could not read the published container port from docker output: ${dockerPortOutput.trim()}`,
    );
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Docker reported an unusable published container port: ${dockerPortOutput.trim()}`,
    );
  }
  return port;
}

export function assertOwnedContainerName(containerName: string): void {
  if (!DRILL_CONTAINER_NAME_PATTERN.test(containerName)) {
    throw new Error(
      `Refusing to touch container "${containerName}" — the drill only removes containers it created itself.`,
    );
  }
}

export function buildRemoveArgs(containerName: string): string[] {
  assertOwnedContainerName(containerName);
  return ["rm", "--force", containerName];
}

export function buildListOwnedArgs(): string[] {
  return [
    "ps",
    "-a",
    "--filter",
    `label=${DRILL_LABEL_KEY}=${DRILL_LABEL_VALUE}`,
    "--format",
    "{{.Names}}",
  ];
}
