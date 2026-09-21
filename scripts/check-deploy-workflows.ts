import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scanDeployWorkflows,
  type WorkflowFile,
} from "./lib/deploy-workflows-scan";

// PR1-C12 — `pnpm check:deploy-workflows`. Pure source parse of the
// three deploy workflows; no GitHub API, no YAML dependency.

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

const files: WorkflowFile[] = [
  "publish.yml",
  "deploy-dev.yml",
  "deploy-prod.yml",
].map((name) => ({
  path: `.github/workflows/${name}`,
  content: readFileSync(join(WORKFLOW_DIR, name), "utf8"),
}));

const violations = scanDeployWorkflows(files);

if (violations.length > 0) {
  console.error("deploy workflow check failed:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log("Deploy workflow check passed (publish, deploy-dev, deploy-prod).");
