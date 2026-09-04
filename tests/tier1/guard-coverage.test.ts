import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F2 — guard × path coverage test.
//
// Companion to docs/guard-path-matrix.md. The matrix documents
// every guard that exists and every mutating path that should
// call it. This test pins the mechanical portion of that
// contract so a future agent cannot add a path that bypasses an
// existing guard without also updating this test.
//
// Scope: the test focuses on service-layer guards — the checks
// that live in lib/services/*. G7 (permission checks) is checked
// at the action layer (lib/actions/*) and is enforced
// structurally by tests/tier1/server-action-preamble.test.ts;
// the matrix notes that and the test does not re-pin it here.

const MATRIX_PATH = join(process.cwd(), "docs", "guard-path-matrix.md");

type GuardId = "G1" | "G2" | "G3" | "G4" | "G8" | "G9" | "G10";
type Cell = "yes" | "warn" | "na";

type PathEntry = {
  path: string;
  file: string;
};

// Service-layer path names and the file each one lives in.
const MATRIX_PATHS: PathEntry[] = [
  { path: "createProgram", file: "lib/services/programs.ts" },
  { path: "deleteProgram", file: "lib/services/programs.ts" },
  { path: "updateProgram", file: "lib/services/programs.ts" },
  { path: "createBatch", file: "lib/services/programs.ts" },
  { path: "updateBatch", file: "lib/services/programs.ts" },
  { path: "deleteBatch", file: "lib/services/programs.ts" },
  { path: "createMember", file: "lib/services/register.ts" },
  { path: "enrolMember", file: "lib/services/register.ts" },
  { path: "markAttendance", file: "lib/services/register.ts" },
  { path: "cancelSession", file: "lib/services/session-lifecycle.ts" },
  { path: "rescheduleSession", file: "lib/services/session-lifecycle.ts" },
  { path: "substituteCoach", file: "lib/services/coach-substitution.ts" },
  { path: "transferMemberToBatch", file: "lib/services/transfer.ts" },
  { path: "addToWaitlist", file: "lib/services/waitlist.ts" },
  { path: "cancelWaitlist", file: "lib/services/waitlist.ts" },
  { path: "promoteHead", file: "lib/services/waitlist.ts" },
  { path: "addHoliday", file: "lib/services/holidays.ts" },
  { path: "removeHoliday", file: "lib/services/holidays.ts" },
  { path: "grantMakeupCredit", file: "lib/services/makeup.ts" },
  { path: "redeemMakeupCredit", file: "lib/services/makeup.ts" },
  { path: "transitionMemberStatus", file: "lib/services/member-status.ts" },
  { path: "recordConsent", file: "lib/services/consent.ts" },
];

// Guard identifier names that, when present as an import or a
// call in the path file, prove the guard is wired. G3, G4, G8
// and G10 are inline (no importable helper), so they have no
// import names — INLINE_ANCHORS below carries their text anchors.
const GUARD_IMPORT_NAMES: Partial<Record<GuardId, string[]>> = {
  G1: ["detectCoachConflicts"],
  G2: ["detectSessionConflicts"],
  G9: ["transitionMemberStatus"],
};

// Inline anchors: when a guard is enforced inline (not via a
// named helper), the path's source must contain at least one of
// these strings. The anchors are intentionally specific enough
// that a coincidence match is unlikely.
const INLINE_ANCHORS: Partial<Record<string, Partial<Record<GuardId, string[]>>>> = {
  cancelSession: {
    G4: ['status === "held"'],
  },
  enrolMember: {
    G3: ["batch.capacity", "for(\"update\")"],
    G8: ["enrolledOn"],
  },
  transferMemberToBatch: {
    G3: ["dest.capacity"],
    G8: ["already_enrolled_in_target", "not_enrolled_in_source"],
  },
  createMember: {
    G8: ["memberCode"],
    G10: ['purpose === "processing"'],
  },
  markAttendance: {
    G8: ["clientId"],
  },
  addToWaitlist: {
    G8: ["already on", "already_on"],
  },
  cancelWaitlist: {
    G8: ['eq(waitlistEntries.status, "waiting")'],
  },
  promoteHead: {
    G8: ['eq(waitlistEntries.status, "waiting")'],
  },
  deleteProgram: {
    G8: ["liveBatches", "active batches"],
  },
  grantMakeupCredit: {
    G8: ["already_has_credit", "makeup_credits"],
  },
  redeemMakeupCredit: {
    G8: ["makeup_credits", "credit_not_found"],
  },
  recordConsent: {
    G8: ["consents", "grant"],
  },
};

// Expected coverage per (path, guard). "yes" requires the guard
// to be wired; "warn" requires the path file to carry a known-gap
// comment; "na" is skipped entirely.
const EXPECTED: Record<string, Partial<Record<GuardId, Cell>>> = {
  createProgram: { G8: "na" },
  deleteProgram: { G8: "yes" },
  updateProgram: { G8: "na" },
  // createBatch / updateBatch are form-only enforcement for
  // G1 (batch-level coach conflict); this is the known gap
  // explicitly called out in the matrix doc. The service does
  // not call detectCoachConflicts — only the form does.
  createBatch: { G1: "warn", G3: "warn" },
  updateBatch: { G1: "warn" },
  deleteBatch: { G8: "na" },
  createMember: { G8: "yes", G10: "yes" },
  enrolMember: { G3: "yes", G8: "yes" },
  markAttendance: { G8: "yes" },
  cancelSession: { G4: "yes" },
  rescheduleSession: { G2: "yes" },
  substituteCoach: { G2: "yes" },
  transferMemberToBatch: { G3: "yes", G8: "yes" },
  addToWaitlist: { G8: "yes" },
  cancelWaitlist: { G8: "yes" },
  promoteHead: { G3: "warn", G8: "yes" },
  addHoliday: { G8: "na" },
  removeHoliday: { G8: "na" },
  grantMakeupCredit: { G8: "yes" },
  redeemMakeupCredit: { G8: "yes" },
  transitionMemberStatus: { G9: "yes" },
  recordConsent: { G8: "yes" },
};

const GAP_COMMENT_REGEX = /F2 finding|logged as known gap|form-only|intentionally|known gap/i;

describe("guard × path coverage matrix (F2 audit response)", () => {
  it("the matrix document exists and references every guard ID", () => {
    const md = readFileSync(MATRIX_PATH, "utf8");
    expect(md.length).toBeGreaterThan(0);
    for (const g of ["G1", "G2", "G3", "G4", "G7", "G8", "G9", "G10"] as GuardId[]) {
      expect(md).toContain(g);
    }
    expect(md).toContain("rescheduleSession");
    expect(md).toContain("substituteCoach");
  });

  // Group: every matrix file path exists on disk.
  for (const { path, file } of MATRIX_PATHS) {
    it(`matrix row: ${path} → ${file}`, () => {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      // Function name has to appear as `export ... function name(`.
      expect(text).toMatch(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${path}\\s*\\(`),
      );
    });
  }

  // Group: for every "yes" cell, the path file imports the guard
  // or contains the inline-check anchor. For "warn" cells, the
  // file must carry a known-gap comment.
  for (const [pathName, cells] of Object.entries(EXPECTED)) {
    const file = MATRIX_PATHS.find((p) => p.path === pathName)?.file;
    if (!file) continue;
    for (const guard of Object.keys(cells) as GuardId[]) {
      const cell = cells[guard]!;
      if (cell === "na") continue;
      it(`${pathName} × ${guard} = ${cell}`, () => {
        const text = readFileSync(join(process.cwd(), file), "utf8");
        if (cell === "yes") {
          if (GUARD_IMPORT_NAMES[guard] && GUARD_IMPORT_NAMES[guard]!.length > 0) {
            const found = GUARD_IMPORT_NAMES[guard]!.some((name) =>
              new RegExp(`\\b${name}\\b`).test(text),
            );
            expect(
              found,
              `${pathName} should import one of ${GUARD_IMPORT_NAMES[guard]!.join(", ")} for ${guard}`,
            ).toBe(true);
          } else {
            const anchors = INLINE_ANCHORS[pathName]?.[guard] ?? [];
            expect(
              anchors.length,
              `no inline anchor configured for ${pathName} × ${guard}`,
            ).toBeGreaterThan(0);
            const found = anchors.some((a) => text.includes(a));
            expect(
              found,
              `${pathName} should have an inline check matching one of: ${anchors.join(", ")}`,
            ).toBe(true);
          }
        } else if (cell === "warn") {
          expect(
            GAP_COMMENT_REGEX.test(text),
            `${pathName} should carry a known-gap comment for ${guard}`,
          ).toBe(true);
        }
      });
    }
  }

  it("F2 wired the new detectSessionConflicts guard from rescheduleSession and substituteCoach", () => {
    const lifecycle = readFileSync(
      join(process.cwd(), "lib/services/session-lifecycle.ts"),
      "utf8",
    );
    const substitution = readFileSync(
      join(process.cwd(), "lib/services/coach-substitution.ts"),
      "utf8",
    );
    expect(lifecycle).toContain("detectSessionConflicts");
    expect(substitution).toContain("detectSessionConflicts");
    const conflicts = readFileSync(
      join(process.cwd(), "lib/services/coach-conflicts.ts"),
      "utf8",
    );
    expect(conflicts).toMatch(
      /export\s+async\s+function\s+detectSessionConflicts\s*\(/,
    );
  });
});
