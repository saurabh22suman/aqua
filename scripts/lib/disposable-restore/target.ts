// B6 — the disposable restore drill's target identity and trust
// boundary.
//
// Restoring a backup is the most destructive operation this repository
// performs: it overwrites a database. The drill therefore never
// accepts a target from the outside world. A restore target is only
// ever a database THIS RUN created, on loopback, under a minted
// identity — never a pasted URL, never a name that belongs to a live,
// staging or development environment.
//
// Everything in this module is a pure predicate: no Docker, no
// database, no network. The predicates are the security control, so
// they are unit-tested exhaustively (tests/backend-b6/backup-restore/
// target.test.ts) and the failure messages are written to be safe to
// print: they never echo a credential.

/** Every disposable target identity this drill can mint starts here. */
export const DRILL_IDENTITY_PREFIX = "aqua-drill-";

/**
 * The identity namespace is CLOSED. Twelve lowercase hex characters is
 * not decoration: the hex alphabet (0-9a-f) cannot spell "prod",
 * "live", "stage" or "dev", so no minted identity can ever collide
 * with a name that reads like a real environment.
 */
export const DRILL_IDENTITY_PATTERN = /^aqua-drill-[0-9a-f]{12}$/;

/** The only hosts a drill container is reachable on. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
]);

/** Database names the drill is allowed to create and restore into. */
export const DRILL_DATABASE_PATTERN = /^aqua_drill(_[a-z0-9]+)?$/;

/** Container names the drill is allowed to create and remove. */
export const DRILL_CONTAINER_PREFIX = "aqua-drill-";

export type DisposableTargetRole = "source" | "destination";

export type DisposableTarget = {
  /** The minted identity. Unique per drill target. */
  identity: string;
  /** Which side of the round trip this target is. */
  role: DisposableTargetRole;
  /** Loopback host the container's published port is reachable on. */
  host: string;
  /** Docker-assigned host port. */
  port: number;
  /** Database name inside the container. */
  database: string;
  /** Container name this run created. */
  containerName: string;
  /** Privileged (superuser) connection string — never logged. */
  adminUri: string;
  /** Application-role connection string — never logged. */
  appUri: string;
  /** Password for the application role — never logged. */
  appPassword: string;
};

/**
 * Words that mean "this database belongs to a real environment". The
 * drill refuses any target whose identity contains one, whatever else
 * it looks like.
 */
const FORBIDDEN_IDENTITY_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/prod/i, "production"],
  [/stag/i, "staging"],
  [/\blive\b|\blived\b/i, "live"],
  [/\bdev\b|\bdevel/i, "development"],
  [/\bmain\b|\bmaster\b/i, "main"],
  [/\breal\b|\bclub\b/i, "customer"],
];

/**
 * A host is safe to echo back in an error only if it cannot be used to
 * smuggle a credential (no "@", no "/", no whitespace).
 */
const SAFE_HOST_ECHO = /^[A-Za-z0-9._:-]{1,255}$/;

function hostForMessage(host: string): string {
  return SAFE_HOST_ECHO.test(host) ? `"${host}"` : "a non-loopback address";
}

/**
 * Rejects any identity that this run did not mint.
 *
 * The message never repeats the rejected value: an identity is
 * operator-supplied text and may be a connection string carrying a
 * password.
 */
export function assertDisposableIdentity(identity: string): void {
  if (typeof identity !== "string" || identity.trim() === "") {
    throw new Error(
      "Disposable restore target identity is required — the drill only restores into a database it created itself.",
    );
  }
  if (identity.includes("://")) {
    throw new Error(
      "Disposable restore target identity must not be a connection string — the drill only restores into a database it created itself.",
    );
  }
  for (const [pattern, word] of FORBIDDEN_IDENTITY_WORDS) {
    if (pattern.test(identity)) {
      throw new Error(
        `Disposable restore target identity names a ${word} environment — the drill refuses any target it did not create.`,
      );
    }
  }
  if (!DRILL_IDENTITY_PATTERN.test(identity)) {
    throw new Error(
      `Disposable restore target identity must be a minted "${DRILL_IDENTITY_PREFIX}<12 hex characters>" identity — the drill refuses any target it did not create.`,
    );
  }
}

/**
 * Rejects any host that is not this machine's loopback interface. The
 * drill's containers publish on 127.0.0.1; nothing else is reachable.
 */
export function assertLoopbackHost(host: string): void {
  if (typeof host !== "string" || !LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Disposable restore target host must be a loopback address (127.0.0.1, ::1 or localhost) — received ${hostForMessage(host)}.`,
    );
  }
}

/**
 * Rejects a round trip that would read from and write to the same
 * database. Restoring a dump over its own source destroys the only
 * copy of the data being verified.
 */
export function assertDistinctTargets(
  source: DisposableTarget,
  destination: DisposableTarget,
): void {
  if (source.identity === destination.identity) {
    throw new Error(
      "The restore source and destination must be two different disposable databases — refusing to restore a database over itself.",
    );
  }
  if (source.containerName === destination.containerName) {
    throw new Error(
      "The restore source and destination must be two different disposable databases — refusing to restore a database over itself.",
    );
  }
  if (source.appUri === destination.appUri) {
    throw new Error(
      "The restore source and destination must be two different disposable databases — refusing to restore a database over itself.",
    );
  }
}

/**
 * The full target contract: minted identity, loopback host, sane
 * port, drill-owned container and database names. Call this on every
 * target before a single byte is written to it.
 */
export function assertDisposableTarget(target: DisposableTarget): void {
  assertDisposableIdentity(target.identity);
  assertLoopbackHost(target.host);
  if (
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535
  ) {
    throw new Error(
      "Disposable restore target port must be a valid TCP port between 1 and 65535.",
    );
  }
  if (!DRILL_DATABASE_PATTERN.test(target.database)) {
    throw new Error(
      `Disposable restore target database must be named "${DRILL_DATABASE_PATTERN.source}" — the drill refuses any database it did not create.`,
    );
  }
  if (!target.containerName.startsWith(DRILL_CONTAINER_PREFIX)) {
    throw new Error(
      `Disposable restore target container must be named under "${DRILL_CONTAINER_PREFIX}" — the drill refuses any container it did not create.`,
    );
  }
}

/**
 * Strips the password out of a connection string so it can be printed.
 * The host, port and database survive — they are what makes a failure
 * diagnosable; the password never does.
 */
export function redactConnectionUri(uri: string): string {
  if (typeof uri !== "string" || uri === "") return "";
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) {
      // Keep the role visible (it is not a secret) but never a password.
      parsed.username = parsed.username;
    }
    return parsed.toString();
  } catch {
    // Not a URL: strip everything between "://" and "@", which is the
    // userinfo segment, and keep the rest.
    return uri.replace(/:\/\/[^@/]*@/, "://***@");
  }
}
