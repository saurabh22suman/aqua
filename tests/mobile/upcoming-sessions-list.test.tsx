// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The substitute control is a separate client island with its own
// server-action wiring; stubbing it keeps this test about the row's
// time rendering, which is the F3 regression surface.
vi.mock("@/components/session-substitute-control", () => ({
  SessionSubstituteControl: () => null,
}));
// The R.4 lifecycle control uses useRouter; the row test is about time
// rendering, so a stub router keeps the app-router invariant happy.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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
  it("shows the applied Owner dates and lets coverage work within that window", () => {
    render(<UpcomingSessionsList
      compactOwner
      dateWindow={{ fromDate: "2026-11-23", toDate: "2026-12-07" }}
      initialSessions={[
        session({ id: "today", sessionDate: "2026-11-23", batchName: "Morning squad" }),
        session({ id: "tomorrow", sessionDate: "2026-11-24", batchName: "Junior squad", coachName: null }),
        session({ id: "last-day", sessionDate: "2026-12-07", batchName: "December squad" }),
      ]}
      terminology={TERMINOLOGY}
      coaches={[]}
      canManage
    />);

    const trigger = () => screen.getByRole("button", { name: /^Session dates/ });
    const open = () => {
      fireEvent.click(trigger());
      return within(screen.getByRole("dialog", { name: "Session dates" }));
    };
    expect(trigger().textContent).toMatch(/23 Nov/);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Next 7 days/ })).toBeNull();

    fireEvent.click(open().getByRole("button", { name: /Next 7 days/ }));
    expect(screen.queryByRole("dialog", { name: "Session dates" })).toBeNull();
    expect(trigger().textContent).toMatch(/29 Nov/);
    expect(screen.getAllByRole("article")).toHaveLength(2);

    const needsCover = screen.getByRole("button", { name: /Needs cover/ });
    fireEvent.click(needsCover);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: /Junior squad/ })).toBeTruthy();

    fireEvent.click(open().getByRole("button", { name: /Full window/ }));
    expect(needsCover.getAttribute("aria-pressed")).toBe("true");
    expect(trigger().textContent).toMatch(/7 Dec/);
    fireEvent.click(needsCover);
    expect(screen.getByRole("article", { name: /December squad/ })).toBeTruthy();
  });

  it("renders 11:30Z–12:30Z as 05:00 pm–06:00 pm, not 11:30–12:30", () => {
    const { container } = render(
      <UpcomingSessionsList
        canManage
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
        canManage
        initialSessions={[session()]}
        coaches={[]}
        terminology={TERMINOLOGY}
      />,
    );
    expect(container.textContent ?? "").toContain("Sat, 12 Sept");
  });
});
