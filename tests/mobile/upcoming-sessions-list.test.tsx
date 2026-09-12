// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The substitute control is a separate client island with its own
// server-action wiring; stubbing it keeps this test about the row's
// time rendering, which is the F3 regression surface.
vi.mock("@/components/session-substitute-control", () => ({
  SessionSubstituteControl: () => null,
}));

import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import type { UpcomingSessionRow } from "@/lib/services/coach-schedule";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

function session(overrides: Partial<UpcomingSessionRow> = {}): UpcomingSessionRow {
  return {
    id: "s1",
    sessionDate: "2026-09-12",
    startsAt: new Date("2026-09-12T11:30:00.000Z"),
    endsAt: new Date("2026-09-12T12:30:00.000Z"),
    batchId: "b1",
    batchName: "Junior TTS",
    coachId: null,
    coachName: "Coach A",
    status: "scheduled",
    ...overrides,
  };
}

afterEach(cleanup);

describe("UpcomingSessionsList — F3 times in IST", () => {
  it("renders 11:30Z–12:30Z as 05:00 pm–06:00 pm, not 11:30–12:30", () => {
    const { container } = render(
      <UpcomingSessionsList
        initialSessions={[session()]}
        coaches={[]}
        terminology={TERMINOLOGY}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("05:00 pm");
    expect(text).toContain("06:00 pm");
    expect(text).not.toContain("11:30");
  });

  it("keeps the header date in IST (regression guard for formatHeaderDate)", () => {
    const { container } = render(
      <UpcomingSessionsList
        initialSessions={[session()]}
        coaches={[]}
        terminology={TERMINOLOGY}
      />,
    );
    expect(container.textContent ?? "").toContain("Sat, 12 Sept");
  });
});
