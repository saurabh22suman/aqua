// @vitest-environment jsdom
//
// Task D, PHASE2 — the retention card as a factual RECORDS SUMMARY.
//
// The human approved (30 October 2026) that the owner view shows
// "Attendance records to review": an aggregate count of members with no
// attendance record in the period. The card must not claim risk, churn
// or absence, and it must not imply that a member without a mark was
// absent.
//
// The with-record count is DERIVED from the cohort (eligible members
// minus the members without records). It is not the legacy
// `membersWithPartialLast30` proxy, whose own one-to-three-marks
// threshold is a different measure and stays in the API.
//
// These cases are written against the component's rendered output only.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RetentionCard } from "@/components/reports/retention-card";

function renderCard(options: {
  history: "sufficient" | "insufficient";
  noRecords?: number;
  eligible?: number;
  /** The legacy one-to-three-marks field. It is never the with-record count. */
  legacyPartial?: number;
  totalActive?: number;
  sessionsInWindow?: number;
  memberLabel?: string;
}) {
  const {
    history,
    noRecords = 0,
    eligible = 0,
    legacyPartial = 0,
    totalActive = 0,
    sessionsInWindow = 0,
    memberLabel = "members",
  } = options;
  render(
    <RetentionCard
      report={{
        row: {
          memberCountAtRisk: noRecords,
          membersWithZeroLast30: noRecords,
          membersWithPartialLast30: legacyPartial,
          totalActiveMembers: totalActive,
        },
        eligibleMemberCount: eligible,
        sessionsInWindow,
        history,
      }}
      memberLabel={memberLabel}
      memberLabelOne={memberLabel.replace(/s$/, "")}
    />,
  );
  return document.body.textContent ?? "";
}

afterEach(() => {
  cleanup();
});

describe("attendance records to review — the card states what it counts", () => {
  it("heads the summary with the factual label and counts the members without records", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 3,
      eligible: 10,
      totalActive: 12,
      sessionsInWindow: 6,
    });

    expect(text).toContain("Attendance records to review");
    expect(text).toContain("3members with no attendance records");
    expect(text).not.toContain("Not enough attendance history");
  });

  it("derives the with-record count from the cohort, not from the legacy partial field", () => {
    // Ten eligible members, three without a record: seven have a
    // record. The legacy partial field stays 0 here — it measures
    // something else (one to three marks) and must not be shown as the
    // attendance count.
    const text = renderCard({
      history: "sufficient",
      noRecords: 3,
      eligible: 10,
      legacyPartial: 0,
      totalActive: 12,
      sessionsInWindow: 6,
    });

    expect(text).toContain("7members with attendance records");
    expect(text).not.toContain("0members with attendance records");
  });

  it("shows one member with a record when the whole cohort has one", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 0,
      eligible: 1,
      legacyPartial: 0,
      totalActive: 1,
      sessionsInWindow: 4,
    });

    expect(text).toContain("1member with an attendance record");
    expect(text).not.toContain("0members with attendance records");
  });

  it("uses the singular form for one member without a record", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 1,
      eligible: 1,
      totalActive: 1,
      sessionsInWindow: 2,
    });

    expect(text).toContain("1member with no attendance record");
    expect(text).toContain("1member active for the period");
    expect(text).not.toContain("members with no attendance records");
  });

  it("uses the tenant's own word for a member", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 2,
      eligible: 3,
      totalActive: 3,
      sessionsInWindow: 2,
      memberLabel: "swimmers",
    });

    expect(text).toContain("2swimmers with no attendance records");
    expect(text).toContain("1swimmer with an attendance record");
  });

  it("explains that any recorded mark is a record and that no mark is not absence", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 1,
      eligible: 2,
      totalActive: 2,
      sessionsInWindow: 2,
    });

    expect(text).toMatch(/present, late or absent/i);
    expect(text).toMatch(/not counted as absent/i);
  });

  it("makes no risk, churn or per-member claim", () => {
    const text = renderCard({
      history: "sufficient",
      noRecords: 4,
      eligible: 6,
      totalActive: 9,
      sessionsInWindow: 5,
    });

    expect(text).not.toMatch(/at risk/i);
    expect(text).not.toMatch(/\brisk\b/i);
    expect(text).not.toMatch(/churn/i);
    expect(text).not.toMatch(/drop.?off/i);
    expect(text).not.toMatch(/predict/i);
  });
});

describe("attendance records to review — the card admits when it has no history", () => {
  it("says there is not enough history instead of counting", () => {
    const text = renderCard({
      history: "insufficient",
      noRecords: 0,
      eligible: 0,
      totalActive: 8,
      sessionsInWindow: 0,
    });

    expect(text).toContain("Not enough attendance history");
    expect(text).toContain("Attendance records to review");
    expect(text).not.toMatch(/at risk/i);
    expect(text).not.toMatch(/\brisk\b/i);
  });

  it("explains that nobody had been here for the whole period when sessions did run", () => {
    const text = renderCard({
      history: "insufficient",
      noRecords: 0,
      eligible: 0,
      totalActive: 8,
      sessionsInWindow: 4,
    });

    expect(text).toContain("Not enough attendance history");
    expect(text).toMatch(/no members had been here for the whole period/i);
  });
});
