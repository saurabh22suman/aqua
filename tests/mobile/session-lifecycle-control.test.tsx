// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.4 (docs/five-day-work-guide.md) — session cancel / reschedule UI.
// The service and actions shipped earlier; the owner-facing controls
// are the missing half. TDD: fails before the component exists.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const cancelSessionAction = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "ok" as const,
    sessionId: "s1",
    newStatus: "cancelled" as const,
    newSessionDate: "2026-09-13",
  })),
);
const rescheduleSessionAction = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "ok" as const,
    sessionId: "s1",
    newStatus: "scheduled" as const,
    newSessionDate: "2026-09-14",
  })),
);
vi.mock("@/lib/actions/session-lifecycle", () => ({
  cancelSessionAction,
  rescheduleSessionAction,
}));

import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
import { zonedWallTimeToInstant } from "@/lib/time/tz";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionLifecycleControl (R.4)", () => {
  it("cancels a session after an inline confirm", async () => {
    render(
      <SessionLifecycleControl
        sessionId="s1"
        sessionDate="2026-09-13"
        startWall="17:00"
        endWall="18:00"
        status="scheduled"
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^cancel session$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await vi.waitFor(() =>
      expect(cancelSessionAction).toHaveBeenCalledWith({ sessionId: "s1" }),
    );
  });

  it("reschedules with IST wall time converted to instants", async () => {
    render(
      <SessionLifecycleControl
        sessionId="s1"
        sessionDate="2026-09-13"
        startWall="17:00"
        endWall="18:00"
        status="scheduled"
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    fireEvent.change(screen.getByTestId("reschedule-date"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByTestId("reschedule-start"), {
      target: { value: "18:00" },
    });
    fireEvent.change(screen.getByTestId("reschedule-end"), {
      target: { value: "19:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new time/i }));

    await vi.waitFor(() =>
      expect(rescheduleSessionAction).toHaveBeenCalledWith({
        sessionId: "s1",
        newSessionDate: "2026-09-14",
        newStartsAt: zonedWallTimeToInstant(
          "2026-09-14",
          "18:00",
          "Asia/Kolkata",
        ).toISOString(),
        newEndsAt: zonedWallTimeToInstant(
          "2026-09-14",
          "19:00",
          "Asia/Kolkata",
        ).toISOString(),
      }),
    );
  });

  it("shows a cancelled session as a badge with a reschedule path", () => {
    render(
      <SessionLifecycleControl
        sessionId="s1"
        sessionDate="2026-09-13"
        startWall="17:00"
        endWall="18:00"
        status="cancelled"
        onChanged={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("Cancelled");
    expect(
      screen.queryByRole("button", { name: /^cancel session$/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /reschedule/i })).toBeTruthy();
  });

  it("surfaces a coach-conflict refusal", async () => {
    rescheduleSessionAction.mockResolvedValueOnce({
      kind: "error",
      code: "coach_conflict",
      message:
        "This session's coach already has another session in the proposed time window.",
      conflictingSessionIds: ["s9"],
    } as never);

    render(
      <SessionLifecycleControl
        sessionId="s1"
        sessionDate="2026-09-13"
        startWall="17:00"
        endWall="18:00"
        status="scheduled"
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    fireEvent.change(screen.getByTestId("reschedule-date"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new time/i }));

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("already has another session"),
    );
  });
});
