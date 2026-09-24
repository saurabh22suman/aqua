import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isImmutableImageTag,
  scanDeployWorkflows,
  type WorkflowFile,
} from "@/scripts/lib/deploy-workflows-scan";

// PR1-C12 positive controls for the deploy-workflow scan. CI runs
// `pnpm check:deploy-workflows`; this file proves the rules fail on
// known-bad input and pass on the real workflow files.

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

function realFiles(): WorkflowFile[] {
  return ["publish.yml", "deploy-dev.yml", "deploy-prod.yml"].map((name) => ({
    path: `.github/workflows/${name}`,
    content: readFileSync(join(WORKFLOW_DIR, name), "utf8"),
  }));
}

const GOOD_PUBLISH = `name: publish
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]
jobs:
  publish:
    if: github.event.workflow_run.conclusion == 'success'
    steps:
      - run: docker push ghcr.io/acme/aqua:sha-abc1234
`;

const GOOD_DEV = `name: deploy-dev
on:
  workflow_run:
    workflows: [publish]
    types: [completed]
jobs:
  retired:
    if: vars.DEV_DEPLOY_ENABLED == 'true'
    steps:
      - run: echo "Dokploy Compose owns Dev"; exit 1
`;

const GOOD_PROD = `name: deploy-prod-approval
on:
  workflow_dispatch:
    inputs:
      image_tag:
        description: Published sha-<12> tag
        required: true
jobs:
  gate:
    steps:
      - run: if [ "$PILOT_RELEASE_GATE" != passed ]; then exit 1; fi; [[ "$TAG" =~ ^sha-[0-9a-f]{12}$ ]]
  approval:
    needs: gate
    environment: production
    steps:
      - run: echo "This workflow does not deploy. Use Dokploy Compose."
`;

function files(overrides: Record<string, string> = {}): WorkflowFile[] {
  const base: Record<string, string> = {
    "publish.yml": GOOD_PUBLISH,
    "deploy-dev.yml": GOOD_DEV,
    "deploy-prod.yml": GOOD_PROD,
  };
  return Object.entries({ ...base, ...overrides }).map(([path, content]) => ({
    path: `.github/workflows/${path}`,
    content,
  }));
}

describe("deploy workflow scan", () => {
  it("passes the known-good workflows", () => {
    expect(scanDeployWorkflows(files())).toEqual([]);
  });

  it("passes the real workflow files", () => {
    expect(scanDeployWorkflows(realFiles())).toEqual([]);
  });

  it("rejects a mutable latest tag", () => {
    const bad = files({
      "publish.yml": GOOD_PUBLISH.replace("sha-abc1234", "latest"),
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("latest")),
    ).toBe(true);
  });

  it("rejects a deploy-dev without the DEV_DEPLOY_ENABLED guard", () => {
    const bad = files({
      "deploy-dev.yml": GOOD_DEV.replace(
        "    if: vars.DEV_DEPLOY_ENABLED == 'true'\n",
        "",
      ),
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("DEV_DEPLOY_ENABLED")),
    ).toBe(true);
  });

  it("rejects an SSH path that would double-manage Dev", () => {
    const bad = files({
      "deploy-dev.yml": `${GOOD_DEV}      - run: ssh deploy@dev ./deploy.sh\n`,
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("cannot deploy remotely")),
    ).toBe(true);
  });

  it("rejects a production workflow with a push trigger", () => {
    const bad = files({
      "deploy-prod.yml": GOOD_PROD.replace(
        "on:\n  workflow_dispatch:",
        "on:\n  push:\n    branches: [main]\n  workflow_dispatch:",
      ),
    });
    expect(
      scanDeployWorkflows(bad).some((v) =>
        v.includes("production workflow must be workflow_dispatch"),
      ),
    ).toBe(true);
  });

  it("rejects a production workflow without the release gate or environment", () => {
    const noGate = files({
      "deploy-prod.yml": GOOD_PROD.replace(/PILOT_RELEASE_GATE/g, "SOMETHING"),
    });
    expect(
      scanDeployWorkflows(noGate).some((v) => v.includes("PILOT_RELEASE_GATE")),
    ).toBe(true);

    const noEnv = files({
      "deploy-prod.yml": GOOD_PROD.replace(
        "environment: production",
        "environment: staging",
      ),
    });
    expect(
      scanDeployWorkflows(noEnv).some((v) =>
        v.includes("production environment"),
      ),
    ).toBe(true);
  });

  it("rejects a Production SSH deploy or a missing gated approval", () => {
    const bad = files({
      "deploy-prod.yml": `${GOOD_PROD}      - run: ssh deploy@prod ./deploy.sh\n`,
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("cannot deploy remotely")),
    ).toBe(true);
    expect(scanDeployWorkflows(files({ "deploy-prod.yml": GOOD_PROD.replace("    needs: gate\n", "") }))
      .some((v) => v.includes("depend on the release gate"))).toBe(true);
  });
});

describe("isImmutableImageTag", () => {
  it("accepts exactly the twelve-character published tag", () => {
    expect(isImmutableImageTag("sha-abcdef123456")).toBe(true);
    expect(isImmutableImageTag("sha-abc1234")).toBe(false);
    expect(isImmutableImageTag("sha-0123456789abcdef0123456789abcdef01234567")).toBe(false);
  });

  it("rejects branches, latest and semver-free refs", () => {
    expect(isImmutableImageTag("main")).toBe(false);
    expect(isImmutableImageTag("latest")).toBe(false);
    expect(isImmutableImageTag("v1.2.3")).toBe(false);
    expect(isImmutableImageTag("sha-")).toBe(false);
    expect(isImmutableImageTag("sha-ZZZZZZZ")).toBe(false);
  });
});
