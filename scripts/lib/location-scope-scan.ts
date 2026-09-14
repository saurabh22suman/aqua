import { readdirSync } from "node:fs";
import { join } from "node:path";

// O-08 (docs/ops-platform-design.md §8) — the location-scope scan.
//
// Rule: every file under lib/services/** that queries a
// location-bearing table (members, batches, sessions, attendance) must
// either consult the location-access helper (resolveLocationAccess) or
// be allowlisted here with a reason. The allowlist is the explicit
// follow-up queue — a new unlisted file that queries one of those
// tables away from the helper fails CI.
//
// This is a file-level reminder, not a proof of per-query filtering:
// the behavioural proof lives in tests/location-scoped-access.test.ts.
// Shared by the CLI (scripts/check-location-scope.ts) and its fixture
// test (tests/scanner-fixtures/location-scope-fixtures.test.ts).

const LOCATION_TABLE_RE =
  /\.from\((members|batches|sessions|attendance)\)|from\s+(members|batches|sessions|attendance)\b/;

const HELPER_MARKER = "resolveLocationAccess(";

export const LOCATION_SCOPE_ALLOWLIST: Record<string, string> = {
  "lib/services/dashboard.ts":
    "owner dashboard aggregates; the owner surface is never location-restricted (access applies to staff)",
  "lib/services/owner-reports.ts":
    "owner reports; the owner surface is never location-restricted",
  "lib/services/coach-member.ts":
    "coach member detail is assignment-scoped (members.read.assigned), which is narrower than location",
  "lib/services/attendance-history.ts":
    "follow-up: reached through a location-checked member detail or coach surface; scope the member/batch history queries when the receptionist surface needs it",
  "lib/services/enrolment.ts":
    "member enrolment history, reached through a location-checked member detail",
  "lib/services/transfer.ts":
    "follow-up: batch transfer is reached through a location-checked member detail; the target batch needs its own check",
  "lib/services/makeup.ts":
    "follow-up: makeup credits are reached through location-checked member/batch surfaces",
  "lib/services/member-status.ts":
    "member status transitions, reached through a location-checked member detail",
  "lib/services/facility-optins.ts":
    "member facility opt-ins, reached through a location-checked member detail",
  "lib/services/session-lifecycle.ts":
    "owner/admin session cancellation and rescheduling (see the action gating); not a staff-scoped surface",
  "lib/services/coach-substitution.ts":
    "owner/admin substitution over the whole tenant; not a staff-scoped surface",
  "lib/services/coach-conflicts.ts":
    "owner/admin conflict detection; not a staff-scoped surface",
  "lib/services/coach-load.ts":
    "reports/analytics; owner surface",
  "lib/services/absence-alerts.ts":
    "daily job (no user identity) plus member alert reads reached through location-checked surfaces",
  "lib/services/parent-view.ts":
    "signed parent-link token scope is deliberate: the token names the child, not a location",
  "lib/services/waitlist.ts":
    "follow-up: waitlist queues are reached through enquiry/member surfaces; scope when the receptionist surface needs it",
  "lib/services/onboarding-checklist.ts":
    "owner onboarding checklist; the owner surface is never location-restricted",
};

// Comments must not count as calling the helper (the ops-action scan
// learned this the hard way): strip them before matching.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

export function scanLocationScope(
  source: string,
  filePath: string,
): { violation: boolean; reason: string | null } {
  if (!filePath.startsWith("lib/services/")) {
    return { violation: false, reason: null };
  }
  const stripped = stripComments(source);
  if (!LOCATION_TABLE_RE.test(stripped)) {
    return { violation: false, reason: null };
  }
  if (stripped.includes(HELPER_MARKER)) {
    return { violation: false, reason: null };
  }
  const allowlisted = LOCATION_SCOPE_ALLOWLIST[filePath];
  if (allowlisted) return { violation: false, reason: allowlisted };
  return {
    violation: true,
    reason: `queries a location-bearing table without ${HELPER_MARKER.slice(0, -1)}()`,
  };
}

export function listServiceFiles(root = process.cwd()): string[] {
  return readdirSync(join(root, "lib", "services"))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => join("lib", "services", f));
}
