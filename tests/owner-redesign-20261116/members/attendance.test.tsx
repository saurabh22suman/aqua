import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";

describe("member attendance evidence", () => {
  it("describes missing marks as unknown and identifies the marked denominator", () => {
    const html = renderToStaticMarkup(<MemberAttendanceGrid today="2026-11-16" rows={[
      { sessionId: "1", sessionDate: "2026-11-15", batchName: "A", status: "present", markedAt: null },
      { sessionId: "2", sessionDate: "2026-11-15", batchName: "A", status: "late", markedAt: null },
      { sessionId: "3", sessionDate: "2026-11-14", batchName: "A", status: "absent", markedAt: null },
      { sessionId: "4", sessionDate: "2026-11-17", batchName: "A", status: "present", markedAt: null },
    ]} />);
    expect(html).toContain("2 of 3 marked sessions attended");
    expect(html).toContain("No record");
    expect(html).not.toMatch(/no session/i);
    expect(html).toContain("67%");
  });

  it("does not call no marks zero percent", () => {
    const html = renderToStaticMarkup(<MemberAttendanceGrid today="2026-11-16" rows={[]} />);
    expect(html).toContain("No sessions marked yet");
    expect(html).not.toContain("0%");
  });
});
