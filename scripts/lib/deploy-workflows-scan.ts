// PR1-C12 — pure checks for the deploy workflows. Rules:
//   * publish.yml publishes one immutable sha-<short> image on a green
//     main CI run; no `latest`.
//   * deploy-dev.yml deploys that exact tag over SSH, verifies the
//     running tag and gates on /api/health; it never rebuilds.
//   * deploy-prod.yml is workflow_dispatch-only, takes a required
//     immutable tag, runs behind the GitHub production environment,
//     is blocked by PILOT_RELEASE_GATE until the PR3 gate passes, and
//     gates on /api/health.
// The known-bad proof lives in
// tests/scanner-fixtures/deploy-workflows-fixtures.test.ts; CI runs
// `pnpm check:deploy-workflows`.

export type WorkflowFile = { path: string; content: string };

const IMMUTABLE_TAG_RE = /^sha-[0-9a-f]{7,40}$/;

export function isImmutableImageTag(tag: string): boolean {
  return IMMUTABLE_TAG_RE.test(tag);
}

export function scanDeployWorkflows(files: ReadonlyArray<WorkflowFile>): string[] {
  const violations: string[] = [];
  const byName = new Map(
    files.map((file) => [file.path.split("/").pop() ?? file.path, file.content]),
  );

  for (const name of ["publish.yml", "deploy-dev.yml", "deploy-prod.yml"]) {
    const content = byName.get(name);
    if (!content) {
      violations.push(`${name}: workflow file is missing.`);
      continue;
    }
    if (content.includes(":latest")) {
      violations.push(`${name}: must not publish or deploy a mutable ":latest" tag.`);
    }
  }

  const publish = byName.get("publish.yml") ?? "";
  if (!/workflow_run:/.test(publish)) {
    violations.push("publish.yml: must trigger on workflow_run (green main CI).");
  }
  if (!/workflows:\s*\["?CI"?\]/.test(publish)) {
    violations.push('publish.yml: workflow_run must watch the "CI" workflow.');
  }
  if (!/branches:\s*\[main\]/.test(publish)) {
    violations.push("publish.yml: workflow_run must be limited to main.");
  }
  if (!/types:\s*\[completed\]/.test(publish)) {
    violations.push("publish.yml: workflow_run must fire on completed runs.");
  }
  if (!/conclusion == 'success'/.test(publish)) {
    violations.push("publish.yml: must require a successful CI conclusion.");
  }
  if (!/docker push/.test(publish)) {
    violations.push("publish.yml: must push the built image to the registry.");
  }

  const dev = byName.get("deploy-dev.yml") ?? "";
  if (!/workflow_run:/.test(dev) || !/workflows:\s*\["?publish"?\]/.test(dev)) {
    violations.push(
      "deploy-dev.yml: must trigger on the publish workflow completing.",
    );
  }
  if (!/ssh /.test(dev)) {
    violations.push("deploy-dev.yml: must deploy over SSH.");
  }
  if (/docker build/.test(dev)) {
    violations.push(
      "deploy-dev.yml: must pull the published tag — docker build would break immutability.",
    );
  }
  if (!/docker inspect/.test(dev)) {
    violations.push(
      "deploy-dev.yml: must verify the deployed tag is the published tag.",
    );
  }
  if (!/\/api\/health/.test(dev)) {
    violations.push("deploy-dev.yml: must gate on /api/health.");
  }

  const prod = byName.get("deploy-prod.yml") ?? "";
  if (!/workflow_dispatch:/.test(prod)) {
    violations.push("deploy-prod.yml: must be manually dispatchable.");
  }
  for (const trigger of ["push:", "pull_request:", "workflow_run:"]) {
    if (new RegExp(`^\\s*${trigger}`, "m").test(prod)) {
      violations.push(
        `deploy-prod.yml: production workflow must be workflow_dispatch-only (found ${trigger}).`,
      );
    }
  }
  if (!/image_tag:/.test(prod) || !/required:\s*true/.test(prod)) {
    violations.push("deploy-prod.yml: must require an image_tag input.");
  }
  if (!/environment:\s*production/.test(prod)) {
    violations.push(
      "deploy-prod.yml: must run behind the GitHub production environment.",
    );
  }
  if (!/PILOT_RELEASE_GATE/.test(prod)) {
    violations.push(
      "deploy-prod.yml: must be blocked by PILOT_RELEASE_GATE until the PR3 release gate passes.",
    );
  }
  if (/docker build/.test(prod)) {
    violations.push(
      "deploy-prod.yml: must pull the published tag — docker build would break immutability.",
    );
  }
  if (!/\/api\/health/.test(prod)) {
    violations.push("deploy-prod.yml: must gate on /api/health.");
  }

  return violations;
}
