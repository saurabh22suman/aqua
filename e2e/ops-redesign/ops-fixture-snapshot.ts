// Ops redesign (28 October 2026) — the review fixture's metrics
// snapshot.
//
// The Overview's KPI strip is a DAILY SNAPSHOT written by the
// platform's own job. Without a snapshot the page says so honestly —
// which is the correct empty state, and the first capture of the
// Overview proves it. But the independent review needs to see the
// POPULATED layout too, so the fixture has a real snapshot.
//
// It is produced by the EXISTING job
// (lib/jobs/platform-metrics-snapshot-job.ts), run against the
// disposable database, dated TODAY in IST. The figures are DERIVED
// from the synthetic tenants the fixture created — nothing is
// hardcoded, and no history is invented: with only today's row, the
// comparison line honestly reads "no comparison yet".
//
// PROVENANCE (recorded for the review):
//   job       : runPlatformMetricsSnapshotJob()
//   date      : today in Asia/Kolkata (the job's own dating rule)
//   source    : the tenants, their health and their open ops tasks
//   database  : the disposable aqua_test_* database only
//
// Run:
//   python3 .opencode/scripts/lane_job.py exec bash -c \
//     'set -a; . ./.env.aqua-harness-test.local; set +a; \
//      pnpm exec tsx e2e/ops-redesign/ops-fixture-snapshot.ts'

import { runPlatformMetricsSnapshotJob } from "@/lib/jobs/platform-metrics-snapshot-job";
import { getPlatformMetricsSummary } from "@/db/platform-overview";
import { todayInZone } from "@/lib/time/tz";

async function main() {
  const date = todayInZone("Asia/Kolkata");
  await runPlatformMetricsSnapshotJob();
  const summary = await getPlatformMetricsSummary();
  console.log("Platform metrics snapshot written by the existing job.");
  console.log(`  job     : runPlatformMetricsSnapshotJob()`);
  console.log(`  date    : ${date} (Asia/Kolkata)`);
  console.log(`  as of   : ${summary.asOf ? summary.asOf.toISOString() : "none"}`);
  console.log(
    `  figures : active=${summary.activeTenants.current} trial=${summary.trialTenants.current} at-risk=${summary.atRiskTenants.current} open-tasks=${summary.openOpsTasks.current}`,
  );
}

main().catch((error) => {
  console.error("The metrics snapshot fixture failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
