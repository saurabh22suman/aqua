// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-08 — reception's Today's check-ins panel. Empty / present /
// absent states plus the one-tap mark. The write path is the existing
// markAttendanceSessionAction with status "present"; the panel holds
// no schema of its own.

const getRosterAction = vi.fn();
const markAttendanceSessionAction = vi.fn();

vi.mock("@/lib/actions/coach", () => ({
  getRosterAction: (...args: unknown[]) => getRosterAction(...args),
  markAttendanceSessionAction: (...args: unknown[]) =>
    markAttendanceSessionAction(...args),
}));

import { ReceptionCheckIns } from "@/components/reception-check-ins";
import type { TodaySession, RosterRow } from "@/lib/actions/coach";

afterEach(() => {
  cleanup();
  getRosterAction.mockReset();
  markAttendanceSessionAction.mockReset();
});

const SESSION: TodaySession = {
  id: "s1",
  batchName: "Junior TTS",
  startsAt: "2026-09-12T01:30:00.000Z",
  endsAt: "2026-09-12T02:30:00.000Z",
  marked: 1,
  total: 2,
};

const ROWS: RosterRow[] = [
  {
    memberId: "m1",
    name: "Aarav Sharma",
    code: "AWS-001",
    status: "present",
    markedAt: "2026-09-12T01:12:00.000Z",
    pct: 100,
    isTrial: false,
  },
  {
    memberId: "m2",
    name: "Diya Patel",
    code: "AWS-002",
    status: null,
    markedAt: null,
    pct: null,
    isTrial: false,
  },
];

describe("U-08 reception check-ins panel", () => {
  it("renders the empty state when there are no sessions today", () => {
    render(<ReceptionCheckIns sessions={[]} canMark />);
    expect(screen.getByTestId("reception-checkins").textContent).toContain(
      "No sessions today",
    );
  });

  it("shows today's sessions with checked-in counts", () => {
    render(<ReceptionCheckIns sessions={[SESSION]} canMark />);
    expect(screen.getByTestId("checkin-session-s1").textContent).toContain(
      "1 / 2 checked in",
    );
    expect(screen.getByTestId("reception-checkins").textContent).toContain(
      "1 checked in",
    );
  });

  it("expands a session into the roster: present shows the time, unmarked offers one-tap check-in", async () => {
    getRosterAction.mockResolvedValue({
      batchName: "Junior TTS",
      startsAt: SESSION.startsAt,
      offlineSyncEnabled: false,
      rows: ROWS,
    });
    markAttendanceSessionAction.mockResolvedValue({ ok: true });

    render(<ReceptionCheckIns sessions={[SESSION]} canMark />);
    fireEvent.click(screen.getByTestId("checkin-session-s1"));

    await screen.findByText("Aarav Sharma");
    expect(screen.getByText("Here · 06:42 am")).toBeTruthy();
    // Avatars ride the member id, not the name (U-09).
    expect(document.querySelector('[data-avatar-seed="m1"]')).toBeTruthy();
    expect(screen.getByText("Diya Patel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check in Diya Patel" }));

    await waitFor(() => {
      expect(markAttendanceSessionAction).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          memberId: "m2",
          status: "present",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Here · /)).toHaveLength(2);
    });
  });

  it("offers no check-in control when the caller cannot mark attendance", async () => {
    getRosterAction.mockResolvedValue({
      batchName: "Junior TTS",
      startsAt: SESSION.startsAt,
      offlineSyncEnabled: false,
      rows: ROWS,
    });

    render(<ReceptionCheckIns sessions={[SESSION]} canMark={false} />);
    fireEvent.click(screen.getByTestId("checkin-session-s1"));

    await screen.findByText("Diya Patel");
    expect(screen.queryByRole("button", { name: "Check in Diya Patel" })).toBeNull();
    expect(screen.getByText("Not checked in")).toBeTruthy();
  });

  it("says so when a session has no one enrolled", () => {
    render(
      <ReceptionCheckIns
        sessions={[{ ...SESSION, marked: 0, total: 0 }]}
        canMark
      />,
    );
    expect(screen.getByTestId("checkin-session-s1").textContent).toContain(
      "No one enrolled",
    );
  });
});
