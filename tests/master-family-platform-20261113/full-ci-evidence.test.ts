import { expect, it } from "vitest";
import { verifyFullCiEvidence } from "@/scripts/lib/full-ci-evidence";

type Run = { id: number; workflow_id: number; path: string; head_sha: string; check_suite_id: number; status: string; conclusion: string | null; created_at: string; run_attempt: number };
type Check = { name: string; head_sha: string; check_suite: { id: number }; app: { id: number }; status: string; conclusion: string | null };
type Verify = (sha: string, runs: Run[], checks: Check[], workflowId?: number) => boolean;
async function verifier(): Promise<Verify> {
  return (sha, runs, checks, workflowId = 55) => verifyFullCiEvidence(sha, runs, checks, workflowId);
}
const sha = "a".repeat(40);
const run: Run = { id: 3, workflow_id: 55, path: ".github/workflows/ci.yml", head_sha: sha, check_suite_id: 42, status: "completed", conclusion: "success", created_at: "2026-11-13T00:00:00Z", run_attempt: 1 };
const check: Check = { name: "ci", head_sha: sha, check_suite: { id: 42 }, app: { id: 15368 }, status: "completed", conclusion: "success" };
it("accepts only the latest completed exact-SHA normal workflow and its matching GitHub Actions check", async () => {
  expect((await verifier())(sha, [run], [check])).toBe(true);
});
it("rejects a same-path run from a different workflow identity", async () => {
  expect((await verifier())(sha, [{ ...run, workflow_id: 56 }], [check], 55)).toBe(false);
});
it("allows a successful newest normal run after an older failed run", async () => {
  const old = { ...run, id: 2, check_suite_id: 41, conclusion: "failure", created_at: "2026-11-12T23:59:00Z" };
  const oldCheck = { ...check, check_suite: { id: 41 }, conclusion: "failure" };
  expect((await verifier())(sha, [old, run], [oldCheck, check])).toBe(true);
});
it("rejects a newer failed run even if an older run succeeded", async () => {
  const newer = { ...run, id: 4, check_suite_id: 43, conclusion: "failure", created_at: "2026-11-13T00:01:00Z" };
  expect((await verifier())(sha, [run, newer], [check, { ...check, check_suite: { id: 43 }, conclusion: "failure" }])).toBe(false);
});
it("rejects missing, pending, failed, cancelled, stale, wrong-SHA, wrong workflow and wrong app evidence", async () => {
  const verify = await verifier();
  expect(verify(sha, [], [check])).toBe(false);
  expect(verify(sha, [run], [])).toBe(false);
  for (const conclusion of ["failure", "cancelled", "stale"]) expect(verify(sha, [{ ...run, conclusion }], [check])).toBe(false);
  expect(verify(sha, [{ ...run, status: "in_progress", conclusion: null }], [check])).toBe(false);
  expect(verify(sha, [{ ...run, head_sha: "b".repeat(40) }], [check])).toBe(false);
  expect(verify(sha, [{ ...run, path: ".github/workflows/khelsuite-safe-candidate.yml" }], [check])).toBe(false);
  expect(verify(sha, [run], [{ ...check, app: { id: 999 } }])).toBe(false);
  expect(verify(sha, [run], [{ ...check, check_suite: { id: 99 } }])).toBe(false);
  expect(verify(sha, [run], [check, { ...check, app: { id: 999 } }])).toBe(false);
  expect(verify(sha, [run, { ...run, id: 4, check_suite_id: 43, status: "queued", conclusion: null, created_at: "2026-11-13T00:01:00Z" }], [check])).toBe(false);
});
