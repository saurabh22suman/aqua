// B6 — the backup and restore half of the drill.
//
// The dump is taken with exactly the flags the production backup CLI
// uses (scripts/db-backup.ts): custom format, no owner, no
// privileges. Those two flags matter for the restore:
//
//   --no-owner      the archive does not carry the source role's
//                   ownership, so it can be restored into a target
//                   whose role differs.
//   --no-privileges the archive does not carry GRANTs, so the target's
//                   own grant policy decides who may read the data
//                   after the restore. The drill then re-applies the
//                   target's grants and PROVES them.
//
// The dump is captured as raw bytes: the custom format is a binary
// stream and decoding it as text would corrupt it.

import {
  assertArchiveIsRestorable,
  assertDumpBytesLookValid,
  redactToolOutput,
  type ArchiveListingResult,
} from "./archive";
import { execInContainerBinary } from "./lifecycle";
import { DRILL_DB_ROLE } from "./containers";
import type { DisposableTarget } from "./target";

/**
 * pg_restore prints one error per conflicting object — a second
 * restore over a populated database produces hundreds of lines. The
 * first lines carry the reason; the rest is noise. The output is
 * redacted before it is truncated, never after.
 */
function toolFailure(tool: string, exitCode: number, stderr: string): Error {
  const detail = redactToolOutput(stderr).trim();
  const shown = detail.length > 2000 ? `${detail.slice(0, 2000)}…` : detail;
  return new Error(
    `${tool} failed (exit ${exitCode})${shown ? `: ${shown}` : "."}`,
  );
}

/**
 * Takes a custom-format dump of the target's database and returns the
 * raw archive bytes.
 */
export function dumpDatabase(target: DisposableTarget): Uint8Array {
  const result = execInContainerBinary(target, [
    "pg_dump",
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    target.database,
    "-U",
    DRILL_DB_ROLE,
  ]);
  if (result.exitCode !== 0) {
    throw toolFailure("pg_dump", result.exitCode, result.stderr);
  }
  const bytes = new Uint8Array(result.stdout);
  assertDumpBytesLookValid(bytes);
  return bytes;
}

/**
 * Asks pg_restore to parse the archive and print its table of
 * contents. This is the authoritative "can this be restored?" check:
 * a truncated archive fails here with "end of file".
 */
export function listArchive(
  target: DisposableTarget,
  bytes: Uint8Array,
): ArchiveListingResult {
  const result = execInContainerBinary(
    target,
    ["pg_restore", "--list", "-U", DRILL_DB_ROLE],
    { input: Buffer.from(bytes) },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr,
  };
}

/**
 * Restores the archive into the target's database. Fails loudly: the
 * caller must never treat a failed restore as a successful drill.
 */
export function restoreArchive(
  target: DisposableTarget,
  bytes: Uint8Array,
): void {
  const result = execInContainerBinary(
    target,
    [
      "pg_restore",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      target.database,
      "-U",
      DRILL_DB_ROLE,
    ],
    { input: Buffer.from(bytes) },
  );
  if (result.exitCode !== 0) {
    throw toolFailure("pg_restore", result.exitCode, result.stderr);
  }
}

/**
 * Proves the archive is restorable BEFORE anything is written to the
 * destination. A corrupt archive must never reach the restore step.
 */
export function assertArchiveIsRestorableInContainer(
  target: DisposableTarget,
  bytes: Uint8Array,
): void {
  assertArchiveIsRestorable(listArchive(target, bytes));
}
