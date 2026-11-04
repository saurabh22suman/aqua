import { readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
const RESOURCE_HELPER_RE = /\b(?:resolveLocationAccess|visibleMember|visibleBatch)\s*\(/;

export const LOCATION_SCOPE_ALLOWLIST: Record<string, string> = {
  "lib/services/staff-candidates.ts":
    "human-approved stricter staff-picker privacy: member home locations use the resolved caller allLocations/locationIds even when general O-08 location scoping is off; existing live staff require staff.read, members require members.read. Runtime privacy regressions pin cross-tenant/location denial and authorized staff-only fallback.",
  "lib/services/dashboard.ts":
    "owner dashboard aggregates; the owner surface is never location-restricted (access applies to staff)",
  "lib/services/makeup.ts":
    "follow-up: makeup credits are reached through location-checked member/batch surfaces",
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
  "lib/services/announcements.ts":
    "announcement audience resolution is a tenant-wide fan-out decided by the owner (audience all/batch/parents); announcements carry no location column, so per-location scoping does not apply",
  "lib/services/announcement-audience.ts":
    "the fan-out resolution itself (same reason as announcements.ts): owner-decided tenant-wide audience, no location column to scope",
  "lib/services/wallet-core.ts":
    "K-05 ledger primitives: the member row is locked by id for balance re-derivation and idempotency, never listed; topUp (wallet.ts) does the location visibility check before calling in",
  "lib/services/leave-approval.ts":
    "V-27 owner/admin leave decisions over the whole tenant (same shape as session-lifecycle.ts and coach-substitution.ts): the uncovered-session read and the roster update are not staff-scoped surfaces",
  // The gate-access lane (lib/services/mock-access/) is the first
  // SUBDIRECTORY under lib/services, so it is the first set of files
  // this scan could only see after the walk became recursive (batch 4).
  // Each entry says why the location-access helper does not apply.
  "lib/services/mock-access/facts.ts":
    "a gate decision is made AT the gate, by a device rather than by a staff session: the gate is bound to one location and the read is the presenting member's own status, not a list of other members' records. There is no caller location scope to apply — resolveLocationAccess would refuse every scan.",
  "lib/services/mock-access/credentials.ts":
    "issuing, revoking and listing a member's own gate card is owner/admin authority over the whole tenant (the same precedent as session-lifecycle.ts and coach-substitution.ts): the read is by member id for one member named in the request, never a list of members.",
  "lib/services/mock-access/override.ts":
    "a staff override is owner/admin authority over the whole tenant (the same precedent as session-lifecycle.ts and coach-substitution.ts): the read is by member id for one member named in the request, and the gate it applies to is a tenant gate.",
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
  if (RESOURCE_HELPER_RE.test(stripped)) {
    return { violation: false, reason: null };
  }
  const allowlisted = LOCATION_SCOPE_ALLOWLIST[filePath];
  if (allowlisted) return { violation: false, reason: allowlisted };
  return {
    violation: true,
    reason: `queries a location-bearing table without ${HELPER_MARKER.slice(0, -1)}()`,
  };
}

// The service tree is walked RECURSIVELY.
//
// The first version of this function was a flat readdirSync of
// lib/services, so a service file in a SUBDIRECTORY was invisible to
// the scan: it could query a location-bearing table away from the
// helper and CI would never see it. The first subdirectory in the tree
// (lib/services/mock-access) turned that from a theoretical gap into a
// live one.
//
// The walk is deterministic (every level is sorted, and so is the
// result), it never leaves the root, and it never follows a symlink
// out of it: a symlink that escapes the root is SKIPPED and REPORTED
// (listOutOfTreeSymlinks) rather than silently dropped, because a file
// hidden behind an out-of-tree link is exactly the kind of blind spot
// this function exists to close.
const SERVICE_ROOT_SEGMENTS = ["lib", "services"];

// Directories that are never service homes. Excluded explicitly, with
// a reason, rather than by accident.
function isExcludedDirectory(name: string): boolean {
  // node_modules is a dependency tree, not our code; a dot-directory
  // is tooling or version-control state.
  return name === "node_modules" || name.startsWith(".");
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function realPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isInside(rootReal: string, candidate: string): boolean {
  return candidate === rootReal || candidate.startsWith(rootReal + sep);
}

export type ServiceTree = {
  /** Repo-relative POSIX paths of every service file, sorted. */
  files: string[];
  /** Symlinks that point outside the root and were NOT followed. */
  escapedSymlinks: string[];
};

export function scanServiceTree(root = process.cwd()): ServiceTree {
  const rootReal = realPathOrNull(root);
  const files: string[] = [];
  const escapedSymlinks: string[] = [];
  const visited = new Set<string>();

  const servicesDir = join(root, ...SERVICE_ROOT_SEGMENTS);
  const servicesReal = realPathOrNull(servicesDir);
  if (!servicesReal) {
    // No service tree at all: the scan would have nothing to say, and
    // saying nothing is how a blind spot survives. Fail loudly.
    throw new Error(
      `check-location-scope: ${join(...SERVICE_ROOT_SEGMENTS)} does not exist under ${root} — there is nothing to scan, and a scan that scans nothing must not pass.`,
    );
  }
  visited.add(servicesReal);

  const walk = (dir: string, segments: string[]): void => {
    // A directory that cannot be read is a directory whose files the
    // scan cannot see. Skipping it quietly would reintroduce the blind
    // spot this walk exists to close, so the scan fails instead.
    const entries = readdirSync(dir, { withFileTypes: true });
    const ordered = [...entries].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );

    for (const entry of ordered) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isExcludedDirectory(entry.name)) continue;
        const real = realPathOrNull(full);
        if (!real) continue;
        // A symlinked directory is only walked when it stays inside
        // the root; the visited set stops a cycle.
        if (rootReal && !isInside(rootReal, real)) {
          escapedSymlinks.push(toPosixPath(relative(root, full)));
          continue;
        }
        if (visited.has(real)) continue;
        visited.add(real);
        walk(full, [...segments, entry.name]);
        continue;
      }

      if (!entry.isFile()) {
        // A symlink to a file: follow it only when its real path is
        // inside the root.
        if (!entry.isSymbolicLink()) continue;
        const real = realPathOrNull(full);
        if (!real || (rootReal && !isInside(rootReal, real))) {
          escapedSymlinks.push(toPosixPath(relative(root, full)));
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        files.push(
          toPosixPath(join(...SERVICE_ROOT_SEGMENTS, ...segments, entry.name)),
        );
        continue;
      }

      if (!entry.name.endsWith(".ts")) continue;
      files.push(
        toPosixPath(join(...SERVICE_ROOT_SEGMENTS, ...segments, entry.name)),
      );
    }
  };

  walk(servicesDir, []);
  return { files: files.sort(), escapedSymlinks: escapedSymlinks.sort() };
}

export function listServiceFiles(root = process.cwd()): string[] {
  return scanServiceTree(root).files;
}

export function listOutOfTreeSymlinks(root = process.cwd()): string[] {
  return scanServiceTree(root).escapedSymlinks;
}
