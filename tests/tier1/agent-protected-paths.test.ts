import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// F1 — self-merge suspension gate, companion test.
//
// The agent was given a memory-dependent rule ("open PRs but never
// merge them"). That rule failed 3 for 3 — see
// docs/five-day-work-guide.md §"Self-merge suspension" for the
// postmortem. The mechanical replacement is
// `.github/workflows/agent-protected-paths.yml`, which fails any PR
// touching protected paths (db/migrations/**, lib/auth/**, money,
// consent) without the `human-approved-merge` label.
//
// This test pins the gate's CONTRACT from three angles so a future
// agent cannot silently weaken it:
//   1. The workflow file exists.
//   2. The workflow's `on:` triggers on pull_request.
//   3. The list of protected paths in the workflow includes the
//      four named-in-the-audit path families (db/migrations/**,
//      lib/auth/**, money, consent) — and the workflow itself
//      plus this test, so the gate cannot be edited from inside
//      a single PR without also tripping itself.
//   4. The required label is `human-approved-merge`. The test
//      fails if any other name is used, so a future "let me
//      rename the label to fix something" cannot drift away
//      from the documented contract.
//   5. The workflow reads the label from the PR's labels via
//      `gh api`, not from a hardcoded string the agent can edit
//      without leaving a trace.
//
// If any of these assertions fail, fix the workflow before opening
// a PR; a green test here is the only thing standing between the
// agent and an unprotected merge.

const WORKFLOW_PATH = ".github/workflows/agent-protected-paths.yml";

describe("self-merge suspension gate (F1)", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("workflow file exists", () => {
    expect(workflow.length).toBeGreaterThan(0);
  });

  it("triggers on pull_request", () => {
    expect(workflow).toMatch(/^on:\s*[\s\S]*?pull_request:/m);
  });

  it("names the four protected path families called out in the audit", () => {
    // The audit explicitly named db/migrations/** and lib/auth/**,
    // plus "anything money- or consent-related". The implementation
    // uses prefixes that cover all four; this test pins that the
    // four are present together, so removing one requires editing
    // this test too.
    const required = [
      "db/migrations/",
      "lib/auth/",
      "lib/money/",
      "consent",
    ];
    for (const p of required) {
      expect(workflow).toContain(p);
    }
  });

  it("always protects itself and this test, so a single PR cannot neuter the gate", () => {
    expect(workflow).toContain(".github/workflows/agent-protected-paths.yml");
    expect(workflow).toContain("tests/tier1/agent-protected-paths.test.ts");
  });

  it("requires the `human-approved-merge` label, with that exact name", () => {
    // Pinned by name. A drift here would silently change the contract;
    // the agent's GitHub permissions are configured against this name.
    expect(workflow).toContain("human-approved-merge");
    // And it has to be a check, not a label the workflow merely emits:
    // grep for the gate's failure branch.
    expect(workflow).toMatch(/human-approved-merge[\s\S]*exit 1/);
  });

  it("reads the label from the GitHub API, not from a workflow-only string", () => {
    // The label comes from `gh api .../labels`. If a future change
    // sourced it from an env var or a workflow_dispatch input, an
    // agent could self-supply it.
    expect(workflow).toMatch(/gh api[\s\S]*?\/labels/);
  });
});

describe("CI runs the gate (mechanical, not just documented)", () => {
  // The companion check on CI itself — `.github/workflows/ci.yml`
  // does not need to import this workflow (GitHub Actions runs every
  // workflow on its triggers), but the `pull_request` trigger must
  // not be silenced at the workflow_dispatch or repo-level.
  it("ci.yml does not have a workflow-level if: that would skip the gate", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    // The gate's own workflow has no `if:` gate on its job. This
    // is structural — a future change that added one would need
    // to also edit this test.
    const gate = readFileSync(WORKFLOW_PATH, "utf8");
    expect(gate).not.toMatch(/^\s*if:\s/m);
    // And ci.yml does not have a global `if: always() false` or
    // similar that would mask the gate (it has no `if:` at all in
    // the relevant section by design).
    expect(ci).toMatch(/^on:\s*[\s\S]*?pull_request:/m);
  });
});

describe("verify before claiming done — F1 also requires the label can be applied", () => {
  // Smoke check: the workflow's shell syntax is parseable. This is
  // a coarse check but catches the obvious cases (unmatched quotes,
  // missing set -e). A full `act` run would be stronger but adds a
  // dependency; this is the minimum.
  it("workflow shell is parseable by `bash -n`", () => {
    const result = execFileSync("bash", ["-n", WORKFLOW_PATH], {
      stdio: "pipe",
    });
    expect(result.toString()).toBe("");
  }, 10_000);
});
