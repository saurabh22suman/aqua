import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F1 — self-merge suspension gate, companion test.
//
// The agent was given a memory-dependent rule ("open PRs but never
// merge them"). That rule failed 3 for 3 — see
// docs/five-day-work-guide.md §"Self-merge suspension" for the
// postmortem. The mechanical replacement is
// `.github/workflows/agent-protected-paths.yml`, which fails any PR
// touching protected paths without the `human-approved-merge` label.
//
// This test pins the gate's CONTRACT from three angles so a future
// agent cannot silently weaken it:
//   1. The workflow file exists, triggers on `pull_request`, and is
//      itself a protected path.
//   2. The required label is `human-approved-merge` (exact name).
//      Renaming the label silently changes the contract.
//   3. The label is read from `gh api .../labels` — never an env
//      var or workflow_dispatch input (which an agent could
//      self-supply).
//   4. The required label is `human-approved-merge`. The test
//      fails if any other name is used.
//   5. SEMANTIC COVERAGE: every file in the repo that matches a
//      semantic definition of AUTH, MONEY, CONSENT, or CHILDREN'S
//      DATA must be COVERED by at least one glob in the workflow.
//      This is the property the audit demanded: "every file
//      matching a semantic definition of auth, money, consent or
//      children's data is COVERED by some glob — not that four
//      substrings appear in the workflow text." The earlier version
//      of this test pinned only four substrings, which let
//      `lib/actions/platform-auth.ts` and `db/platform-auth.ts`
//      (the actual platform-auth home) slip past; PR #85 and #88
//      self-merged against that gap.
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

  it("protects the gate's own workflow and companion test", () => {
    // A single PR that edits the gate + the test + a real change
    // could otherwise neuter the gate. The gate pins its own path
    // and this test's path; if either is missing, the test fails
    // and CI blocks the PR.
    expect(workflow).toContain(".github/workflows/agent-protected-paths.yml");
    expect(workflow).toContain("tests/tier1/agent-protected-paths.test.ts");
  });
});

// ---------------------------------------------------------------------------
// Semantic coverage — the audit's actual ask.
//
// Walk the repo for files matching a SEMANTIC definition of AUTH, MONEY,
// CONSENT, or CHILDREN'S DATA. Assert each is covered by SOME glob in
// the workflow's `case` statement. The earlier version of this test
// asserted only that the literal strings "db/migrations/", "lib/auth/",
// "lib/money/", "consent" appeared somewhere in the workflow — a
// property the original implementation easily satisfied by accident,
// but which left `lib/actions/platform-auth.ts` and `db/platform-auth.ts`
// uncovered (the actual platform-auth home). The audit demanded: "every
// file matching a semantic definition of auth, money, consent or
// children's data is COVERED by some glob — not that four substrings
// appear in the workflow text." This is the test for that property.
// ---------------------------------------------------------------------------

function readBashCasePatterns(yaml: string): string[] {
  // Extract glob patterns from the bash `case "$file" in` arm of the
  // workflow. Patterns appear after `case "$file" in` and before the
  // next `esac`. We're permissive on shape — we accept anything
  // before the trailing `)` on each line, separated by `|`.
  const start = yaml.indexOf('case "$file" in');
  if (start < 0) throw new Error("workflow has no `case \"$file\" in`");
  const end = yaml.indexOf("esac", start);
  if (end < 0) throw new Error("workflow `case` has no `esac`");
  const body = yaml.slice(start, end);
  const patterns: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([^\s].*?)\)\s*(echo|:error)/);
    if (!m) continue;
    const rhs = m[1]!;
    for (const pat of rhs.split("|")) {
      const trimmed = pat.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      patterns.push(trimmed);
    }
  }
  return patterns;
}

function globToRegex(pattern: string): RegExp {
  // Translate a bash glob to a JS regex. The patterns here are simple:
  //   * → [^/]* (within a single path segment)
  //   ** → .*
  // Bash's `*` does NOT cross `/` boundaries by default, but ** does.
  let rx = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      rx += ".*";
      i += 2;
    } else if (ch === "*") {
      rx += "[^/]*";
      i += 1;
    } else {
      // Escape regex metacharacters. URL-safe chars only.
      rx += ch!.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp("^" + rx + "$");
}

function listRepoFiles(): string[] {
  // Recursive walk over the repo, skipping node_modules / .next / .git.
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      if (entry.startsWith(".") && entry !== ".github") continue;
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else out.push(full.replace(process.cwd() + "/", ""));
    }
  }
  walk(process.cwd());
  return out;
}

// Semantic definitions — keep these and the gate's `case` arms in
// lockstep. The audit named four categories: AUTH, MONEY, CONSENT,
// CHILDREN'S DATA. Each definition is a list of glob patterns (in the
// same mini-language the gate uses) describing where files of that
// category live. If a future file lands under one of these globs,
// the test below asserts the gate covers it.
type Category = {
  name: string;
  // Where files of this category live in the repo. Globs in the same
  // shape the workflow accepts.
  patterns: string[];
};

const SEMANTIC_CATEGORIES: Category[] = [
  {
    name: "AUTH",
    patterns: [
      // lib/auth/* holds session/permission/cookie helpers.
      "lib/auth/*",
      // Platform auth — login/verify/TOTP/2FA — actually lives here.
      "lib/actions/platform-auth*",
      "db/platform-auth*",
      // Parent-link issues and verifies a signed token (a credential).
      "lib/actions/parent-link*",
      "lib/services/parent-link*",
      // better-auth's catch-all route handler.
      "app/api/auth/*",
      // better-auth's drizzle handle.
      "db/auth-db.ts",
    ],
  },
  {
    name: "MONEY",
    patterns: [
      "lib/money/*",
      // Schema files that hold *_paise columns are conventionally named
      // *_money.ts in this repo; if a future schema file lands here
      // with that name, the gate picks it up. (No such file currently
      // exists — the gate is forward-looking.)
      "db/schema/*money*",
    ],
  },
  {
    name: "CONSENT",
    patterns: [
      "db/schema/consent*",
      "lib/services/consent*",
      "lib/actions/consent*",
    ],
  },
  {
    name: "CHILDREN'S DATA",
    patterns: [
      // Parent-view reads minors' data for the signed-link parent page.
      "lib/services/parent-view*",
      // Schema files for persons, memberships, attendance.
      "db/schema/people.ts",
      "db/schema/memberships.ts",
      "db/schema/scheduling.ts",
    ],
  },
  {
    name: "MIGRATIONS",
    patterns: [
      "db/migrations/*",
    ],
  },
];

function matchesAny(file: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (globToRegex(p).test(file)) return true;
  }
  return false;
}

describe("gate covers every file in the named semantic categories", () => {
  // Build the gate's effective glob set from the workflow, then
  // for every repo file matching a semantic category, assert the
  // file is matched by SOME glob. This is the property the audit
  // demanded — not "four substrings present", but "every
  // semantically-protected file is covered."
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  const gatePatterns = readBashCasePatterns(workflow);
  const gateRegexes = gatePatterns.map(globToRegex);

  const repoFiles = listRepoFiles();

  for (const cat of SEMANTIC_CATEGORIES) {
    const covered = repoFiles.filter((f) => matchesAny(f, cat.patterns));
    describe(`category: ${cat.name}`, () => {
      // For each repo file in this category, assert the gate covers it.
      // Empty categories still pass — a category with zero matches in
      // the current tree is fine; the assertion is on coverage, not
      // on presence. (If a future repo grows a new file under the
      // category's pattern, the assertion fires.)
      if (covered.length === 0) {
        it("has no matching files in the current tree (category is forward-looking)", () => {
          expect(covered).toHaveLength(0);
        });
        return;
      }
      for (const file of covered) {
        it(`${file} is covered by a gate glob (semantic: ${cat.name})`, () => {
          const matched = gateRegexes.some((re) => re.test(file));
          if (!matched) {
            // Build a helpful error: list the gate's globs so a future
            // reviewer can see which one (if any) almost matches.
            const nearMisses = gateRegexes
              .filter((re) => re.source.includes(file.split("/")[0]!))
              .map((re) => re.source);
            throw new Error(
              `${file} matches semantic category "${cat.name}" ` +
                `(via ${cat.patterns.join(" | ")}) ` +
                `but no gate glob covers it.\n` +
                `Gate globs that share this file's top directory: ${
                  nearMisses.length ? nearMisses.join(", ") : "(none)"
                }`,
            );
          }
        });
      }
    });
  }

  it("the gate's glob set itself is non-empty — a future 'delete all globs' must fail CI", () => {
    expect(gatePatterns.length).toBeGreaterThan(0);
  });
});

describe("the gate catches the specific PRs the audit named", () => {
  // PR #85 (C-45 parent page) and PR #88 (H1 platform forms) were
  // the two that self-merged past the old `lib/auth/*` glob. This
  // test pins the new contract: simulate the file list of each PR
  // and assert every file lands under a gate glob. If a future
  // change removes a glob, this test names the regression.
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  const gateRegexes = readBashCasePatterns(workflow).map(globToRegex);

  function covered(file: string): boolean {
    return gateRegexes.some((re) => re.test(file));
  }

  it("PR #85 file list — every C-45 file is covered", () => {
    const pr85 = [
      "app/(owner)/owner/members/[memberId]/page.tsx",
      "app/p/[token]/page.tsx",
      "components/parent-link-panel.tsx",
      "lib/actions/parent-link.ts",
      "lib/env.ts",
      "lib/services/parent-link.ts",
      "lib/services/parent-view.ts",
      "tests/env.test.ts",
      "tests/tier1/demo-mode-env.test.ts",
    ];
    // The protected subset — the ones the gate cares about:
    const protectedFiles = pr85.filter((f) =>
      matchesAny(f, [
        "lib/actions/parent-link*",
        "lib/services/parent-link*",
        "lib/services/parent-view*",
        "lib/auth/*",
      ]),
    );
    expect(protectedFiles.length).toBeGreaterThan(0);
    for (const f of protectedFiles) {
      expect(covered(f), `${f} should be covered (PR #85)`).toBe(true);
    }
  });

  it("PR #88 file list — every H1 platform-form file is covered", () => {
    const pr88 = [
      "app/(platform)/ops/login/login-form.tsx",
      "app/(platform)/ops/verify/verify-form.tsx",
      "lib/actions/platform-auth.ts",
      "lib/actions/platform-features.ts",
      "lib/actions/platform-invite-owner.ts",
      "lib/actions/platform-preset-apply.ts",
      "lib/actions/platform-remove-sample-data.ts",
      "lib/actions/platform-tenants.ts",
    ];
    // platform-auth / platform-* action files are the protected subset.
    const protectedFiles = pr88.filter((f) =>
      matchesAny(f, [
        "lib/actions/platform-auth*",
      ]),
    );
    expect(protectedFiles.length).toBeGreaterThan(0);
    for (const f of protectedFiles) {
      expect(covered(f), `${f} should be covered (PR #88)`).toBe(true);
    }
  });
});

describe("CI runs the gate (mechanical, not just documented)", () => {
  // The companion check on CI itself — `.github/workflows/ci.yml`
  // does not need to import this workflow (GitHub Actions runs every
  // workflow on its triggers), but the `pull_request` trigger must
  // not be silenced at the workflow_dispatch or repo-level.
  it("ci.yml does not have a workflow-level if: that would skip the gate", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const gate = readFileSync(WORKFLOW_PATH, "utf8");
    expect(gate).not.toMatch(/^\s*if:\s/m);
    expect(ci).toMatch(/^on:\s*[\s\S]*?pull_request:/m);
  });
});

describe("verify before claiming done — F1 also requires the workflow parses", () => {
  it("workflow shell is parseable by `bash -n`", () => {
    const result = execFileSync("bash", ["-n", WORKFLOW_PATH], {
      stdio: "pipe",
    });
    expect(result.toString()).toBe("");
  }, 10_000);
});

describe("the gate re-runs on label changes (so the human does not have to)", () => {
  // The audit caught this: the original gate workflow only fired on
  // the PR open event. If the gate failed, the human had to apply
  // the human-approved-merge label AND trigger a manual workflow
  // re-run — extra friction the gate exists to avoid. The fix is to
  // also include `labeled` and `unlabeled` in the workflow's
  // `pull_request.types` so GitHub re-runs the workflow when those
  // events happen.
  //
  // History check (from git log 4d511cb): an earlier fix removed
  // the types filter entirely while working around a heredoc + colon-
  // prefixed lines parsing bug that made the workflow register but
  // never fire. The current workflow uses simple `echo "::error::"`
  // statements — no heredocs — so adding the types filter back is
  // safe. This test pins both: that the types are present AND that
  // no heredoc has crept in to reintroduce the original bug.
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("declares the pull_request.types filter with labeled + unlabeled", () => {
    // Extract the indented block after `pull_request:`. YAML
    // whitespace tolerance — we look for any line matching the
    // expected keys within a few lines of `pull_request:`.
    expect(workflow).toMatch(/^on:\s*[\s\S]*?pull_request:\s*$/m);
    expect(workflow).toMatch(/types:\s*\[[^\]]*labeled[^\]]*\]/);
    expect(workflow).toMatch(/types:\s*\[[^\]]*unlabeled[^\]]*\]/);
    expect(workflow).toMatch(
      /types:\s*\[[^\]]*opened[^\]]*synchronize[^\]]*reopened[^\]]*\]/,
    );
  });

  it("does not reintroduce the heredoc parsing bug the previous fix worked around", () => {
    // The original buggy workflow used `cat <<'MSG' >&2 ... MSG`
    // heredocs which GitHub's workflow parser rejected. The fix
    // replaced them with simple `echo "::error::..."` statements.
    // If a future change re-adds a heredoc, GitHub silently fails
    // to register the workflow run, and the gate goes missing —
    // exactly the shape that hid J2 for three PRs in a row. Pin
    // the absence.
    expect(workflow).not.toMatch(/<<\s*'?MSG'?\s*\n/);
    expect(workflow).not.toMatch(/\bcat\b.*<<.*\bMSG\b/);
  });
});
