import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// One process at a time: these suites share a seeded Postgres, and some
// migration suites create/drop their own databases. Vitest's fileParallelism
// is false as well. Sharding bounds per-process memory without weakening
// coverage or racing fixture cleanup.
const SHARDS = 4;

type FileEntry = { file: string };
type TestResult = {
  name: string;
  status: string;
  message?: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: Array<{ status: string; fullName: string; failureMessages: string[] }>;
};
type Report = { testResults: TestResult[]; numPassedTests: number; numFailedTests: number; numPendingTests: number };

function run(args: string[], quiet = false): { status: number; stdout: string } {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(), env: process.env, encoding: "utf8", maxBuffer: 30 * 1024 * 1024,
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (result.stdout && !quiet) process.stdout.write(result.stdout);
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

const listed = run(["exec", "vitest", "list", "--filesOnly", "--staticParse", "--json"], true);
if (listed.status !== 0) throw new Error("Vitest could not list the test files.");
const expected = new Set((JSON.parse(listed.stdout) as FileEntry[]).map(({ file }) => resolve(file)));
if (!expected.size) throw new Error("No test files were discovered.");

const work = mkdtempSync(join(tmpdir(), "aqua-test-shards-"));
const observed = new Map<string, number>();
const slow: Array<{ file: string; ms: number }> = [];
let filesFailed = 0;
let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;
let failed = false;

try {
  if (run(["pretest"]).status !== 0) throw new Error("Platform catalogue seed failed.");
  for (let index = 1; index <= SHARDS; index++) {
    const output = join(work, `shard-${index}.json`);
    console.log(`Running complete-suite shard ${index}/${SHARDS} (serial files)…`);
    const result = run(["exec", "vitest", "run", `--shard=${index}/${SHARDS}`,
      "--maxWorkers=1", "--reporter=json", `--outputFile=${output}`], true);
    if (result.status !== 0) failed = true;
    let report: Report;
    try { report = JSON.parse(readFileSync(output, "utf8")) as Report; }
    catch { throw new Error(`Shard ${index} produced no JSON result (${work}).`); }
    testsPassed += report.numPassedTests;
    testsFailed += report.numFailedTests;
    testsSkipped += report.numPendingTests;
    for (const file of report.testResults) {
      const key = resolve(file.name);
      observed.set(key, (observed.get(key) ?? 0) + 1);
      if (file.status === "failed") {
        filesFailed++;
        console.error(`FAILED ${file.name}: ${file.message ?? ""}`);
        for (const test of file.assertionResults ?? []) {
          if (test.status === "failed") console.error(`${test.fullName}: ${test.failureMessages.join("\n")}`);
        }
      }
      const ms = (file.endTime ?? 0) - (file.startTime ?? 0);
      slow.push({ file: key, ms });
    }
    console.log(`Shard ${index}/${SHARDS}: ${report.testResults.length} files; ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped.`);
  }
  const missing = [...expected].filter((file) => !observed.has(file));
  const duplicates = [...observed].filter(([, count]) => count !== 1);
  const unexpected = [...observed.keys()].filter((file) => !expected.has(file));
  console.log(`Aggregate: ${observed.size}/${expected.size} files, ${testsPassed} passed, ${testsFailed} failed, ${testsSkipped} skipped; ${filesFailed} failing files.`);
  console.log("Slowest test files (wall time):");
  for (const { file, ms } of slow.sort((a, b) => b.ms - a.ms).slice(0, 10)) {
    console.log(`  ${Math.round(ms)}ms ${file.replace(process.cwd() + "/", "")}`);
  }
  if (missing.length || duplicates.length || unexpected.length) {
    console.error({ missing, duplicates, unexpected });
    failed = true;
  }
  if (testsFailed || filesFailed) failed = true;
  if (failed) throw new Error(`Sharded gate failed; JSON evidence: ${work}`);
  rmSync(work, { recursive: true, force: true });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
