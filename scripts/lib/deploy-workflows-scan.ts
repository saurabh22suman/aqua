// Pure checks for publish and the human-managed Dokploy workflows. Rules:
//   * publish.yml publishes one immutable sha-<short> image on a green
//     main CI run; no `latest`.
//   * deploy-dev.yml cannot bring up an SSH-managed second Dev stack.
//   * deploy-prod.yml is approval ONLY: exact published tag, release
//     gate, production environment approval, no remote deployment.
// The known-bad proof lives in
// tests/scanner-fixtures/deploy-workflows-fixtures.test.ts; CI runs
// `pnpm check:deploy-workflows`.

export type WorkflowFile = { path: string; content: string };

const IMMUTABLE_TAG_RE = /^sha-[0-9a-f]{12}$/;

function activeLines(source: string): string {
  return source.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
}

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
  // deploy-dokploy-compose PR — the guard that keeps deploy-dev skipped
  // (not failed) while the Dev environment has no SSH secrets and the
  // Dokploy Compose path is the approved deploy.
  if (!/vars\.DEV_DEPLOY_ENABLED == 'true'/.test(dev)) {
    violations.push(
      "deploy-dev.yml: must be gated on vars.DEV_DEPLOY_ENABLED == 'true' so it is skipped, not failed, while Dev secrets are absent.",
    );
  }
  if (!/exit 1/.test(dev) || !/Dokploy Compose/.test(dev)) {
    violations.push("deploy-dev.yml: activating the retired guard must fail with Dokploy instructions.");
  }
  for (const name of ["deploy-dev.yml", "deploy-prod.yml"] as const) {
    const commands = activeLines(byName.get(name) ?? "").split("\n")
      .filter((line) => /^\s*-\s*run:/.test(line) || /^ {8,}(?:ssh|scp|docker (?:build|compose)|curl)\b/.test(line))
      .join("\n");
    if (/\b(?:ssh|scp|docker (?:build|compose)|curl)\b/.test(commands)) {
      violations.push(`${name}: cannot deploy remotely; Dokploy Compose is human-operated.`);
    }
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
  if (!prod.includes("^sha-[0-9a-f]{12}$")) {
    violations.push("deploy-prod.yml: require an exact published sha-<12 hex> tag.");
  }
  if (!prod.includes("This workflow does not deploy")) {
    violations.push("deploy-prod.yml: make the manual Dokploy handoff explicit.");
  }
  if (!/needs:\s*gate/.test(prod)) {
    violations.push("deploy-prod.yml: production approval must depend on the release gate.");
  }

  return violations;
}
