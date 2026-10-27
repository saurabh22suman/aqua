// B6 — the drill's command line.
//
// The single most important property of this CLI is what it does NOT
// accept. There is no restore-to-an-arbitrary-URL mode, no
// --target-url, no positional database argument. The drill creates its
// own two throwaway databases and restores into one of them. A restore
// tool that accepts a pasted URL is a tool that will one day be
// pointed at production by accident.
//
// So the CLI's job is as much to REFUSE as to run. Every refusal
// message is written to be safe to print: it names the option, never
// the value, because the value may be a connection string.

import type { DrillResult } from "./drill";

export type CliOptions = {
  /** Leave the two containers running so they can be inspected. */
  preserve: boolean;
  /** Emit a machine-readable JSON summary instead of the text report. */
  json: boolean;
};

export type CliAction =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "error"; message: string };

/**
 * Flags that would turn the drill into a restore-to-arbitrary-target
 * tool. They are refused explicitly rather than ignored, so that
 * "the flag did nothing" is never mistaken for "the flag was
 * honoured".
 */
const TARGET_FLAGS: ReadonlySet<string> = new Set([
  "--target-url",
  "--destination-url",
  "--source-url",
  "--target",
  "--destination",
  "--source",
  "--restore-to",
  "--database-url",
  "--pg-url",
  "--connection-string",
]);

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--preserve", "--json"]);
const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);

/** An option name is safe to echo; a value never is. */
const SAFE_FLAG_NAME = /^--?[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;

export const CLI_USAGE = `Usage: pnpm exec tsx scripts/verify-disposable-restore.ts [options]

Proves that a pg_dump custom-format backup taken from a PostgreSQL 16
database restores into a SEPARATE PostgreSQL 16 database and is usable:
schema and migrations, exact records, exact bigint paise, application
role grants, RLS enabled and forced, and two-tenant isolation.

The drill creates BOTH databases itself, on loopback, on ports Docker
assigns, and removes them when it finishes. There is deliberately no
option to restore into a database you name — a restore tool that takes
a pasted URL is a restore tool that eventually gets pointed at
production by accident.

Options:
  --preserve   Leave the two containers running after a successful drill
               so they can be inspected. A FAILED drill always removes
               them.
  --json       Print a machine-readable JSON summary instead of the
               text report.
  --help, -h   Show this message.

Exit codes: 0 = the restored database passed every check; 1 = the drill
failed (and removed every container it created).`;

export function parseCliArgs(argv: string[]): CliAction {
  const options: CliOptions = { preserve: false, json: false };

  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) return { kind: "help" };

    if (TARGET_FLAGS.has(arg)) {
      return {
        kind: "error",
        message:
          "The disposable restore drill has no restore-to-an-arbitrary-target mode: it creates its own two throwaway databases and restores into one of them. " +
          `Refusing "${arg}".`,
      };
    }

    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === "--preserve") options.preserve = true;
      if (arg === "--json") options.json = true;
      continue;
    }

    if (arg.startsWith("-")) {
      const name = SAFE_FLAG_NAME.test(arg) ? `"${arg}"` : "that option";
      return {
        kind: "error",
        message: `Unknown option ${name}. Run with --help to see the options this drill accepts.`,
      };
    }

    // A positional argument. Its value is never echoed: it may be a
    // connection string carrying a password.
    return {
      kind: "error",
      message:
        "The disposable restore drill takes no positional arguments — it restores into a database it creates itself, never one you name. " +
        "Run with --help to see the options this drill accepts.",
    };
  }

  return { kind: "run", options };
}

/**
 * The human-readable report. It carries the evidence an operator needs
 * and no credential: the container names, the ports, the row and
 * migration counts and the paise totals are all diagnosable; the
 * password never appears.
 */
export function formatDrillReport(result: DrillResult): string {
  const s = result.summary;
  const isolation = s.isolation
    .map(
      (probe) =>
        `tenant ${probe.scopeTenantId} sees ${probe.visibleMemberIds.length} of its own members, ${probe.otherTenantMemberIdsVisible.length} of the other tenant's`,
    )
    .join("; ");

  const lines = [
    "Disposable backup/restore drill — PASSED",
    "",
    `  Source container       ${result.source.containerName} (${result.source.host}:${result.source.port}/${result.source.database})`,
    `  Destination container  ${result.destination.containerName} (${result.destination.host}:${result.destination.port}/${result.destination.database})`,
    `  Dump size              ${result.dumpBytes} bytes (custom format, pg_restore --list readable)`,
    `  Migrations restored    ${s.migrations.destination.length} of ${s.migrations.source.length}`,
    `  Records identical      ${s.records.identical ? "yes" : "NO"} (${s.records.destination.length} synthetic tenants)`,
    `  Money exact            ${s.money.exact ? "yes" : "NO"} (${s.money.restoredInvoiceTotalPaise} paise)`,
    `  Application grants     ${s.grants.missing.length === 0 ? "complete" : `MISSING: ${s.grants.missing.join(", ")}`}`,
    `  RLS enabled + forced   ${s.rls.notEnabled.length === 0 && s.rls.notForced.length === 0 ? "yes" : "NO"}`,
    `  Role attributes        ${s.roleAttributes.superuser.length === 0 && s.roleAttributes.bypassRls.length === 0 ? "app_user/app_login are neither superuser nor BYPASSRLS" : "IMPROPER"}`,
    `  Tenant isolation       ${isolation}`,
    `  Append-only tables     ${s.grants.appendOnlyViolations.length === 0 ? "still append-only" : `VIOLATED: ${s.grants.appendOnlyViolations.join(", ")}`}`,
    "",
    result.preserved
      ? `  Containers PRESERVED   ${result.createdContainerNames.join(", ")} (remove them with: docker rm --force ${result.createdContainerNames.join(" ")})`
      : `  Containers removed      ${result.createdContainerNames.length} created by this drill`,
  ];
  return lines.join("\n");
}

/**
 * The machine-readable report. Same rule: no credential, ever.
 */
export function formatDrillReportJson(result: DrillResult): string {
  const s = result.summary;
  return JSON.stringify(
    {
      ok: s.problems.length === 0,
      dumpBytes: result.dumpBytes,
      source: {
        identity: result.source.identity,
        containerName: result.source.containerName,
        host: result.source.host,
        port: result.source.port,
        database: result.source.database,
      },
      destination: {
        identity: result.destination.identity,
        containerName: result.destination.containerName,
        host: result.destination.host,
        port: result.destination.port,
        database: result.destination.database,
      },
      migrations: {
        source: s.migrations.source.length,
        destination: s.migrations.destination.length,
        missing: s.migrations.missing,
        unexpected: s.migrations.unexpected,
      },
      recordsIdentical: s.records.identical,
      money: s.money,
      grants: s.grants,
      rls: s.rls,
      roleAttributes: s.roleAttributes,
      isolation: s.isolation,
      problems: s.problems,
      containers: {
        created: result.createdContainerNames,
        preserved: result.preserved,
      },
    },
    null,
    2,
  );
}
