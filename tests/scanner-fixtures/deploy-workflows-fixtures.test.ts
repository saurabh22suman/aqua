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
  deploy:
    steps:
      - run: ssh deploy@dev "deploy sha-abc1234"
      - run: docker inspect --format '{{.Config.Image}}' aqua-web
      - run: curl -fsS https://dev.example/api/health
`;

const GOOD_PROD = `name: deploy-prod
on:
  workflow_dispatch:
    inputs:
      image_tag:
        description: Immutable sha-<short> tag
        required: true
jobs:
  gate:
    if: vars.PILOT_RELEASE_GATE != 'passed'
    steps:
      - run: exit 1
  deploy:
    environment: production
    steps:
      - run: ssh deploy@prod "deploy \${{ inputs.image_tag }}"
      - run: curl -fsS https://prod.example/api/health
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

  it("rejects a deploy-dev that rebuilds instead of pulling the published tag", () => {
    const bad = files({
      "deploy-dev.yml": `${GOOD_DEV}      - run: docker build -t aqua .\n`,
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("docker build")),
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

  it("rejects workflows that lack a health gate", () => {
    const bad = files({
      "deploy-dev.yml": GOOD_DEV.replace(
        "      - run: curl -fsS https://dev.example/api/health\n",
        "",
      ),
    });
    expect(
      scanDeployWorkflows(bad).some((v) => v.includes("/api/health")),
    ).toBe(true);
  });
});

describe("isImmutableImageTag", () => {
  it("accepts sha-<short> and full commit tags", () => {
    expect(isImmutableImageTag("sha-abc1234")).toBe(true);
    expect(
      isImmutableImageTag("sha-0123456789abcdef0123456789abcdef01234567"),
    ).toBe(true);
  });

  it("rejects branches, latest and semver-free refs", () => {
    expect(isImmutableImageTag("main")).toBe(false);
    expect(isImmutableImageTag("latest")).toBe(false);
    expect(isImmutableImageTag("v1.2.3")).toBe(false);
    expect(isImmutableImageTag("sha-")).toBe(false);
    expect(isImmutableImageTag("sha-ZZZZZZZ")).toBe(false);
  });
});
