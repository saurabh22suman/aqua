import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAttendanceReport } from "@/lib/services/owner-reports";
import { getAttendanceByBatch } from "@/lib/services/owner-insights";
import {
  PERIOD,
  closeFixturePool,
  createTenantFixture,
  type TenantFixture,
} from "./fixture";

// Backend batch 6 — attendance-report session eligibility.
//
// The report and the Home insights view must agree on WHICH SESSIONS
// count. A cancelled session is not a chance to attend, so it is not
// an attendance-eligible session: it contributes no session, no mark
// and no percentage to the report, exactly as it contributes nothing
// to the insights view.
//
// The report's denominator stays what it has always been: RECORDED
// MARKS. A member on the roster with no mark is "unknown", not
// absent, and never enters the denominator. The register-completion
// measurement lives in the insights view; the two numbers are
// deliberately different measurements, documented in
// docs/backend/attendance-report-semantics.md.

let fixture: TenantFixture;

beforeAll(async () => {
  fixture = await createTenantFixture("elig", [
    {
      // Cancelled AFTER the coach marked it: the attendance rows stay.
      name: "Alpha Cancelled Only",
      sessions: [
        {
          date: "2026-11-10",
          status: "cancelled",
          marks: [
            { member: 0, status: "present" },
            { member: 1, status: "present" },
            { member: 2, status: "late" },
          ],
        },
      ],
    },
    {
      name: "Beta Mixed",
      sessions: [
        {
          date: "2026-11-11",
          status: "cancelled",
          marks: [
            { member: 0, status: "present" },
            { member: 1, status: "absent" },
          ],
        },
        {
          date: "2026-11-12",
          status: "held",
          marks: [
            { member: 0, status: "present" },
            { member: 1, status: "late" },
          ],
        },
      ],
    },
    {
      name: "Gamma Held Control",
      sessions: [
        {
          date: "2026-11-13",
          status: "held",
          marks: [
            { member: 0, status: "present" },
            { member: 1, status: "present" },
            { member: 2, status: "late" },
            { member: 3, status: "absent" },
          ],
        },
      ],
    },
    {
      // Only two of five members were marked: the report measures the
      // marks that exist, not the roster that could have been marked.
      name: "Delta Partially Marked",
      sessions: [
        {
          date: "2026-11-14",
          status: "held",
          marks: [
            { member: 0, status: "present" },
            { member: 1, status: "present" },
          ],
        },
      ],
    },
    {
      name: "Epsilon Boundaries",
      sessions: [
        {
          date: PERIOD.from,
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
        {
          date: PERIOD.to,
          status: "held",
          marks: [{ member: 1, status: "present" }],
        },
      ],
    },
  ]);
});

afterAll(async () => {
  await fixture?.cleanup();
  await closeFixturePool();
});

async function rowFor(name: string) {
  const rows = await getAttendanceReport(fixture.ownerCtx, PERIOD);
  return rows.find((r) => r.batchId === fixture.batchIds.get(name));
}

describe("attendance report — cancelled sessions are not attendance-eligible", () => {
  it("excludes a cancelled session that carries marks from every figure", async () => {
    const row = await rowFor("Alpha Cancelled Only");

    expect(row).toBeDefined();
    // The batch is still reported — a batch never disappears because
    // its sessions were cancelled.
    expect(row?.sessionCount).toBe(0);
    expect(row?.presentMarks).toBe(0);
    expect(row?.totalMarks).toBe(0);
    // No marks, no percentage — never 0%, which would read as "nobody
    // attended" instead of "there was nothing to attend".
    expect(row?.pct).toBeNull();
  });

  it("counts only the non-cancelled sessions of a mixed batch", async () => {
    const row = await rowFor("Beta Mixed");

    expect(row?.sessionCount).toBe(1);
    // Only the held session's marks: 1 present + 1 late.
    expect(row?.presentMarks).toBe(2);
    expect(row?.totalMarks).toBe(2);
    expect(row?.pct).toBe(100);
  });

  it("leaves a non-cancelled session's marks untouched", async () => {
    const row = await rowFor("Gamma Held Control");

    expect(row?.sessionCount).toBe(1);
    // present + late count as attendance; absent is a recorded mark.
    expect(row?.presentMarks).toBe(3);
    expect(row?.totalMarks).toBe(4);
    expect(row?.pct).toBe(75);
  });

  it("measures a partially marked session by recorded marks, not by roster size", async () => {
    const row = await rowFor("Delta Partially Marked");

    expect(row?.sessionCount).toBe(1);
    // Two marks exist; the three unmarked members are unknown, not
    // absent, and never enter the denominator.
    expect(row?.totalMarks).toBe(2);
    expect(row?.presentMarks).toBe(2);
    expect(row?.pct).toBe(100);
  });

  it("includes the period start and excludes the period end", async () => {
    const row = await rowFor("Epsilon Boundaries");

    // The session on `from` counts; the session on `to` is outside
    // the window (the end of the period is exclusive).
    expect(row?.sessionCount).toBe(1);
    expect(row?.totalMarks).toBe(1);
    expect(row?.pct).toBe(100);
  });
});

// The reason this rule exists: an owner who drills down from the
// Home insights chart into the attendance report has to see the same
// sessions. These assertions read BOTH views over the same fixture —
// the report and the insights read model — and require them to agree
// on the sessions they count and on the marks they count.
describe("attendance report reconciles with the Home insights attendance view", () => {
  it("counts the same eligible sessions and the same recorded marks", async () => {
    const reportRows = await getAttendanceReport(fixture.ownerCtx, PERIOD);
    const insight = await getAttendanceByBatch(fixture.ownerCtx, PERIOD);

    const reportByBatch = new Map(reportRows.map((r) => [r.batchId, r]));

    // Every batch the insights view reports must be reported by the
    // report with the same session count and the same recorded marks.
    expect(insight.rows.length).toBeGreaterThan(0);
    for (const insightRow of insight.rows) {
      const reportRow = reportByBatch.get(insightRow.batchId);
      expect(reportRow, `report row for ${insightRow.batchName}`).toBeDefined();
      expect(reportRow?.sessionCount).toBe(insightRow.sessions);
      expect(reportRow?.totalMarks).toBe(insightRow.marks.total);
      // The report folds 'late' into its attendance figure; the
      // insights view keeps the two apart. Same total, same split.
      expect(reportRow?.presentMarks).toBe(
        insightRow.marks.present + insightRow.marks.late,
      );
    }
  });

  it("excludes the cancelled session from the shared session count", async () => {
    const insight = await getAttendanceByBatch(fixture.ownerCtx, PERIOD);
    const beta = insight.rows.find(
      (r) => r.batchId === fixture.batchIds.get("Beta Mixed"),
    );

    // The cancelled session is absent from the insights view's count,
    // and the report now counts the same one session.
    expect(beta?.sessions).toBe(1);
    expect(beta?.marks.total).toBe(2);
  });
});
