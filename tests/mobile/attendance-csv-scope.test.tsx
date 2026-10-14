// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — the attendance CSV link carries
// the same facility scope as the displayed report.

vi.mock("@/lib/actions/owner-reports", () => ({
  attendanceReportCsvAction: vi.fn(),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: vi.fn(async () => ({ overrides: {}, locale: "en" })),
}));

import { AttendanceReportCard } from "@/components/reports/attendance-report-card";

const FACILITY = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("AttendanceReportCard CSV scope (P1)", () => {
  it("includes the facility in the CSV link", async () => {
    const el = await AttendanceReportCard({
      rows: [],
      period: { from: "2026-10-01", to: "2026-11-01" },
      locationId: FACILITY,
    });
    render(el);
    const link = document.querySelector("a[href*='attendance.csv']")!;
    expect(link.getAttribute("href")).toBe(
      `/owner/reports/attendance.csv?from=2026-10-01&to=2026-11-01&locationId=${FACILITY}`,
    );
  });

  it("omits the facility when the report is tenant-wide", async () => {
    const el = await AttendanceReportCard({
      rows: [],
      period: { from: "2026-10-01", to: "2026-11-01" },
    });
    render(el);
    const link = document.querySelector("a[href*='attendance.csv']")!;
    expect(link.getAttribute("href")).toBe(
      "/owner/reports/attendance.csv?from=2026-10-01&to=2026-11-01",
    );
  });
});
