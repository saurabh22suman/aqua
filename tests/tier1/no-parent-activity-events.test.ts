import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// E-05 — the parent/student surface emits ZERO activity events
// (architecture.md §8.11: "no writes from /p/[token] or any
// parent/student surface, enforced by a source scan"; PostHog is
// staff-surfaces-only for the same DPDP reason).
//
// This scans the three homes that make up the parent surface:
//   - app/(parent)/   — the parent layout and page
//   - app/p/          — the signed-token parent route
//   - lib/services/parent-*.ts — the parent data/service layer
//
// Any reference to the events machinery (write, emit, table name)
// there is a violation. The positive half of the test pins the one
// sanctioned staff call site, so this scan can't pass vacuously by
// the emit path quietly disappearing.

const ROOT = process.cwd();

const PARENT_SURFACES = ["app/(parent)", "app/p"] as const;

const EVENTS_RE =
  /activity_events|activityEvents|emitActivityEvents|ActivityEvent|ACTIVITY_INGEST|activity-ingest/;

function listFiles(relPath: string): string[] {
  const abs = join(ROOT, relPath);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(abs);
  return out;
}

function parentServiceFiles(): string[] {
  return readdirSync(join(ROOT, "lib/services"))
    .filter((f) => f.startsWith("parent-") && /\.(ts|tsx)$/.test(f))
    .map((f) => join(ROOT, "lib/services", f));
}

describe("E-05 — no activity events from parent/student surfaces", () => {
  const scanned = [
    ...PARENT_SURFACES.flatMap((surface) => listFiles(surface)),
    ...parentServiceFiles(),
  ];

  it("actually scanned the parent surfaces (a moved directory can't make this vacuous)", () => {
    expect(listFiles("app/(parent)").length).toBeGreaterThan(0);
    expect(listFiles("app/p").length).toBeGreaterThan(0);
    expect(parentServiceFiles().length).toBeGreaterThan(0);
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("no parent-surface file references the activity_events machinery", () => {
    const offenders = scanned
      .filter((file) => EVENTS_RE.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(`${ROOT}/`, ""));
    expect(offenders).toEqual([]);
  });

  it("the sanctioned staff call site exists (attendance marking emits the event)", () => {
    const coach = readFileSync(join(ROOT, "lib/actions/coach.ts"), "utf8");
    expect(coach).toContain("emitActivityEvents(");
    expect(coach).toContain("session.attendance_marked");
    // Emit must come after the mutation, not before it.
    expect(coach.indexOf("await markAttendance(ctx, input)")).toBeLessThan(
      coach.indexOf("emitActivityEvents("),
    );
  });
});
