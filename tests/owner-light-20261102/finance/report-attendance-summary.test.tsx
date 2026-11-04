// @vitest-environment jsdom
//
// Finance lane — P2 attendance summary (3 November 2026).
// Intended RED: the big percentage KPI is in the default view and the method
// (rate + denominator) is not in Details; the chart and group data must stay.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttendanceResults } from "@/components/reports/owner-approved/attendance-results";
import type { AttendanceByBatchInsight } from "@/lib/services/owner-insights";

const DATA: AttendanceByBatchInsight = {
  from: "2026-10-27",
  to: "2026-11-02",
  summary: {
    sessions: 12,
    marks: { present: 60, late: 2, absent: 4, total: 66 },
    shares: { present: 91, late: 3, absent: 6 },
    register: {
      sessionsWithRoster: 10,
      completedRegisters: 8,
      completionPct: 80,
      rosterSlots: 72,
      markedSlots: 66,
      unmarkedSlots: 6,
    },
  },
  rows: [
    {
      batchId: "b1",
      batchName: "Junior Swim",
      programName: "Swimming",
      locationId: null,
      sessions: 4,
      marks: { present: 20, late: 1, absent: 2, total: 23 },
      shares: { present: 87, late: 4, absent: 9 },
      register: {
        sessionsWithRoster: 4,
        completedRegisters: 3,
        completionPct: 75,
        rosterSlots: 24,
        markedSlots: 23,
        unmarkedSlots: 1,
      },
    },
  ],
} as AttendanceByBatchInsight;

afterEach(cleanup);

describe("attendance summary composition", () => {
  it("keeps the rate and denominator in Details, not as a default KPI", () => {
    const { container } = render(<AttendanceResults data={DATA} />);
    const section = container.querySelector("section")!;

    // The big default percentage is gone.
    expect(section.querySelector("p.text-2xl")).toBeNull();
    expect(section.textContent).not.toMatch(/\b91%/);

    // The accurate rate and denominator move into the existing disclosure.
    const details = section.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.textContent).toMatch(/Present or late among recorded marks/);
    expect(details!.textContent).toMatch(/60 present/);
    expect(details!.textContent).toMatch(/66 marks recorded|66 recorded/);

    // The actual stacked graph and the group data stay.
    const graph = section.querySelector('[role="img"][aria-label*="Recorded marks"]');
    expect(graph, "stacked recorded-marks graph stays").not.toBeNull();
    expect(section.textContent).toContain("Junior Swim");
    expect(section.textContent).toMatch(/registers complete/);
  });
});
