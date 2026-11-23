export type CiRun = { id: number; workflow_id: number; path: string; head_sha: string; check_suite_id: number; status: string; conclusion: string | null; created_at: string; run_attempt: number };
export type CiCheck = { name: string; head_sha: string; check_suite: { id: number }; app: { id: number }; status: string; conclusion: string | null };

/** The caller requests at most 100 records and refuses incomplete evidence. */
export function completeEvidencePage(page: unknown, field: "workflow_runs" | "check_runs"): boolean {
  if (!page || typeof page !== "object") return false;
  const value = page as Record<string, unknown>;
  const count = value.total_count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100 && Array.isArray(value[field]) && value[field].length === count;
}

/** Fail closed: one exact-SHA check from the newest normal CI workflow run. */
export function verifyFullCiEvidence(sha: string, runs: CiRun[], checks: CiCheck[], workflowId: number): boolean {
  if (!/^[a-f0-9]{40}$/i.test(sha) || !Number.isSafeInteger(workflowId) || workflowId <= 0) return false;
  const matching = runs.filter((run) => run.workflow_id === workflowId && run.path === ".github/workflows/ci.yml" && run.head_sha === sha);
  if (!matching.length || matching.some((run) => !Number.isFinite(Date.parse(run.created_at)))) return false;
  matching.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id || b.run_attempt - a.run_attempt);
  const latest = matching[0];
  if (latest.status !== "completed" || latest.conclusion !== "success") return false;
  // Earlier workflow runs can leave same-name checks behind. Only the
  // latest run's suite is eligible, and ambiguity inside it fails closed.
  const named = checks.filter((check) => check.name === "ci" && check.head_sha === sha && check.check_suite?.id === latest.check_suite_id);
  if (named.length !== 1) return false;
  const check = named[0];
  return check.check_suite?.id === latest.check_suite_id && check.app?.id === 15368 && check.status === "completed" && check.conclusion === "success";
}
