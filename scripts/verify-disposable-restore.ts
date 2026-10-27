#!/usr/bin/env tsx
// B6 — the disposable backup/restore drill, as an operator runs it.
//
//   pnpm exec tsx scripts/verify-disposable-restore.ts [--preserve] [--json]
//
// This is the reproducible LOCAL prerequisite for the production
// restore drill in docs/deployment.md §"Backups and restore". It is
// NOT that drill: this one creates two throwaway PostgreSQL 16
// databases on this machine and restores between them. It proves the
// backup/restore chain works; it does not prove that a specific R2
// object restores, and it never touches R2, staging or production.
//
// The drill has no target option on purpose. It creates its own source
// and destination databases, on loopback, on ports Docker assigns,
// and removes exactly what it created. See
// scripts/lib/disposable-restore/cli.ts for why.
//
// Exit codes: 0 = the restored database passed every check;
// 1 = the drill failed, and every container it created was removed.

import {
  CLI_USAGE,
  formatDrillReport,
  formatDrillReportJson,
  parseCliArgs,
} from "@/scripts/lib/disposable-restore/cli";
import { runDisposableRestoreDrill } from "@/scripts/lib/disposable-restore/drill";

async function main(): Promise<void> {
  const action = parseCliArgs(process.argv.slice(2));

  if (action.kind === "help") {
    console.log(CLI_USAGE);
    return;
  }
  if (action.kind === "error") {
    console.error(action.message);
    process.exit(1);
  }

  const result = await runDisposableRestoreDrill({
    preserve: action.options.preserve,
    appPoolTarget: "source",
    onProgress: (message) => {
      if (!action.options.json) console.log(`… ${message}`);
    },
  });

  console.log(
    action.options.json
      ? formatDrillReportJson(result)
      : formatDrillReport(result),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
