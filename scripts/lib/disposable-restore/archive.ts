// B6 — deciding whether a dump is actually restorable.
//
// The existing backup library (scripts/lib/db-backup.ts) checks the
// five-byte "PGDMP" header. That proves the bytes are shaped like a
// custom-format archive; it does NOT prove the archive can be read.
// A dump truncated at 90% carries the same header as a good one, and
// it is exactly the case where an operator believes they have a
// backup and do not.
//
// So the drill asks the tool that will do the restore: `pg_restore
// --list` parses the archive and prints its table of contents. A
// readable archive lists its entries; a truncated one fails with
// "end of file". The functions here are pure decisions over that
// tool's result, so they are unit-tested without Docker.
//
// Everything a tool prints is passed through redactToolOutput() first:
// pg_restore and pg_dump both echo connection strings on failure, and
// a connection string carries a password.

const DUMP_MAGIC = "PGDMP";

export type ArchiveListingResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ArchiveVerdict = {
  restorable: boolean;
  reason: string;
};

/** A table-of-contents entry line, e.g. "215; 1259 16385 TABLE public t aqua". */
const TOC_ENTRY = /^\d+;\s+\d+\s+\d+\s+\S/m;

/** Removes the password from any connection string in the text. */
const URI_CREDENTIAL =
  /([a-z][a-z0-9+.-]*:\/\/)([^\s@/]*)(@[^\s/]*)/gi;

/** Removes the value of any password-shaped environment assignment. */
const PASSWORD_ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]*(?:password|passwd|pwd))\s*=\s*("[^"]*"|'[^']*'|\S+)/gi;

/**
 * Strips credentials out of tool output so a failure can be printed.
 * The host, port and database survive — they are what makes a
 * failure diagnosable; the password never does.
 */
export function redactToolOutput(text: string): string {
  if (typeof text !== "string" || text === "") return "";
  return text
    .replace(URI_CREDENTIAL, (match, scheme: string, userinfo: string, rest: string) => {
      const colon = userinfo.indexOf(":");
      if (colon < 0) return `${scheme}${userinfo}${rest}`;
      return `${scheme}${userinfo.slice(0, colon)}:***${rest}`;
    })
    .replace(PASSWORD_ASSIGNMENT, (_match, name: string) => `${name}=***`);
}

/**
 * The cheap check: the bytes are shaped like a custom-format archive.
 * It says nothing about whether the archive can be read — that is
 * interpretArchiveListing()'s job.
 */
export function assertDumpBytesLookValid(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new Error("Backup dump is empty — the drill refuses to restore from it.");
  }
  const header = new TextDecoder().decode(bytes.slice(0, DUMP_MAGIC.length));
  if (header !== DUMP_MAGIC) {
    throw new Error(
      `Backup dump does not start with ${DUMP_MAGIC} — not a pg_dump custom-format archive.`,
    );
  }
}

/**
 * Decides whether `pg_restore --list` proved the archive readable.
 *
 * A verdict of "not restorable" always carries a reason the operator
 * can act on, and never carries a credential.
 */
export function interpretArchiveListing(
  result: ArchiveListingResult,
): ArchiveVerdict {
  if (result.exitCode !== 0) {
    const detail = redactToolOutput(result.stderr).trim();
    return {
      restorable: false,
      reason: detail
        ? `pg_restore could not read the archive: ${detail}`
        : "pg_restore could not read the archive.",
    };
  }

  const stdout = redactToolOutput(result.stdout);

  if (!TOC_ENTRY.test(stdout)) {
    return {
      restorable: false,
      reason:
        "The archive lists no entries — restoring it would produce an empty database.",
    };
  }

  if (!/^\s*;\s*Format:\s*CUSTOM\s*$/m.test(stdout)) {
    return {
      restorable: false,
      reason:
        "The archive is not in pg_dump custom format — the drill only restores custom-format dumps.",
    };
  }

  return { restorable: true, reason: "" };
}

/**
 * Throws unless pg_restore proved the archive readable.
 */
export function assertArchiveIsRestorable(result: ArchiveListingResult): void {
  const verdict = interpretArchiveListing(result);
  if (!verdict.restorable) {
    throw new Error(verdict.reason);
  }
}
