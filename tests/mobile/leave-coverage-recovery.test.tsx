// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P2 (2026-10-13) — a failed coverage read is not "no
// uncovered sessions", the decision path reports thrown failures, and
// a failed decision does not silently close the review panel.

const listUncoveredSessionsAction = vi.hoisted(() => vi.fn());
const approveLeaveRequestAction = vi.hoisted(() => vi.fn());
const rejectLeaveRequestAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/leave", () => ({
  listUncoveredSessionsAction,
  approveLeaveRequestAction,
  rejectLeaveRequestAction,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { LeaveDecisionControls } from "@/components/leave-decision-controls";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LeaveDecisionControls recovery (P2)", () => {
  it("distinguishes a failed coverage read from an empty one and retries", async () => {
    listUncoveredSessionsAction
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    render(<LeaveDecisionControls requestId="r1" />);

    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    await waitFor(() =>
      expect(screen.getByText(/could not check coverage/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/none — no sessions/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(screen.getByText(/none — no sessions/i)).toBeTruthy(),
    );
  });

  it("keeps the review open with an error when the decision throws", async () => {
    listUncoveredSessionsAction.mockResolvedValue([]);
    approveLeaveRequestAction.mockRejectedValue(new Error("lost"));
    render(<LeaveDecisionControls requestId="r1" />);

    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    await waitFor(() => expect(screen.getByText(/none — no sessions/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/did not reach the server/i),
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
