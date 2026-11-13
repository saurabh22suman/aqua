import { completeEvidencePage, verifyFullCiEvidence, type CiCheck, type CiRun } from "./lib/full-ci-evidence";

const sha = process.env.GITHUB_SHA ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "";
const token = process.env.GITHUB_TOKEN ?? "";
if (!/^[a-f0-9]{40}$/i.test(sha) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) {
  throw new Error("Missing or invalid candidate SHA, repository, or read-only token");
}

async function github(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub evidence request failed with HTTP ${response.status}`);
  return response.json();
}

type Page<T> = { total_count: number } & T;
const runs = await github(`/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`) as Page<{ workflow_runs: CiRun[] }>;
const checks = await github(`/commits/${sha}/check-runs?filter=all&per_page=100`) as Page<{ check_runs: CiCheck[] }>;
const workflow = await github("/actions/workflows/ci.yml") as { id: number; path: string };
if (!workflow || workflow.path !== ".github/workflows/ci.yml" || !completeEvidencePage(runs, "workflow_runs") || !completeEvidencePage(checks, "check_runs") || !verifyFullCiEvidence(sha, runs.workflow_runs, checks.check_runs, workflow.id)) {
  throw new Error("Full normal CI evidence is missing, incomplete, stale, ambiguous or failed for this exact candidate SHA. Run full CI on a PR for this SHA, then rerun this supplemental workflow.");
}
console.log(`Full normal CI evidence verified for candidate ${sha}`);
