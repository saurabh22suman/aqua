import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// E-02 — tenant audit coverage closure. The behavioural half lives
// in the per-service suites (branding, terminology, coach
// substitution, staff invitations, membership activation); this file
// is the mechanical half:
//
//   1. The old TODO markers are gone for good. A reintroduced
//      `TODO(tenant-audit-log)` or `TODO(F-14)` fails here even if no
//      behavioural test happens to exercise the new site.
//   2. Each service mutation calls writeAudit with its expected
//      action name. Deleting one call flips this red without needing
//      to boot Postgres.
//
// The mutation proof for the write itself is behavioural:
// tests/tier1/branding.test.ts and tests/tier1/staff-invitations.test.ts
// each assert exactly one row on success and zero on a rejected
// mutation, so removing the write (or the guard before it) turns
// those files red.

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "db"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = SCAN_DIRS.flatMap((dir) => listTsFiles(join(ROOT, dir)));

describe("tenant audit TODO markers (E-02)", () => {
  it("no TODO(tenant-audit-log) or TODO(F-14) remains in lib/ or db/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, "utf8");
      if (src.includes("TODO(tenant-audit-log)") || src.includes("TODO(F-14)")) {
        offenders.push(file.replace(ROOT + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("tenant audit call sites (E-02)", () => {
  const EXPECTED: Array<{ file: string; action: string }> = [
    { file: "lib/services/branding.ts", action: '"branding.update"' },
    { file: "lib/services/terminology.ts", action: '"terminology.update"' },
    { file: "lib/services/terminology.ts", action: '"terminology.clear"' },
    { file: "lib/services/coach-substitution.ts", action: '"session.substitute"' },
    { file: "lib/services/staff-invitations.ts", action: '"staff.invite"' },
    { file: "lib/services/staff-invitations.ts", action: '"staff.invitation.revoke"' },
    { file: "lib/services/staff-invitations.ts", action: '"staff.invitation.resend"' },
    { file: "db/membership-activation.ts", action: '"membership.activate"' },
    { file: "lib/services/invite-link.ts", action: '"membership.activate"' },
    { file: "lib/services/shifts.ts", action: '"shift_template.create"' },
    { file: "lib/services/shifts.ts", action: '"shift.create"' },
    { file: "lib/services/shifts.ts", action: '"shift.delete"' },
    { file: "lib/services/shifts.ts", action: '"shift.publish"' },
    { file: "lib/services/staff-attendance.ts", action: '"staff.attendance.check_in"' },
    { file: "lib/services/staff-attendance.ts", action: '"staff.attendance.check_out"' },
    { file: "lib/services/staff-attendance.ts", action: '"staff.attendance.correct"' },
    { file: "lib/services/leave.ts", action: '"leave_type.create"' },
    { file: "lib/services/leave.ts", action: '"leave_type.update"' },
    { file: "lib/services/leave.ts", action: '"leave.request"' },
    { file: "lib/services/leave.ts", action: '"leave.cancel"' },
  ];

  it("every site calls writeAudit with a named action", () => {
    for (const { file, action } of EXPECTED) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} must import writeAudit`).toContain(
        'from "@/lib/audit/write"',
      );
      expect(src, `${file} must write ${action}`).toContain(action);
    }
  });
});
