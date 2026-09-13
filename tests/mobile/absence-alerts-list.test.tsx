// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// R.8 — the coach member-detail alert list. Read-only lines; the
// parent surface gets the same fact as one line on /p/[token].
import { AbsenceAlertsList } from "@/components/absence-alerts-list";
import type { MemberAlertRow } from "@/lib/services/absence-alerts";

const ALERTS = [
  {
    alertId: "a1",
    alertKind: "consecutive_absences",
    batchName: "Junior TTS",
    calendarWeek: "2026-W37",
    detail: { streak: 3 },
    createdAt: new Date("2026-09-13T02:00:00.000Z"),
  },
  {
    alertId: "a2",
    alertKind: "low_monthly_attendance",
    batchName: "Evening Juniors",
    calendarWeek: "2026-W37",
    detail: { pct: 25, total: 4 },
    createdAt: new Date("2026-09-13T02:00:00.000Z"),
  },
] as MemberAlertRow[];

afterEach(cleanup);

describe("AbsenceAlertsList (R.8)", () => {
  it("renders nothing when there are no alerts", () => {
    const { container } = render(<AbsenceAlertsList alerts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("spells out the streak and the low-attendance alert", () => {
    render(<AbsenceAlertsList alerts={ALERTS} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("3 sessions missed in a row");
    expect(text).toContain("Junior TTS");
    expect(text).toContain("Attendance below the alert level");
    expect(text).toContain("Evening Juniors");
  });
});
