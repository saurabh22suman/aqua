// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.resetAllMocks();
});

describe("LeaveDecisionControls recovery (P2)", () => {
  it("distinguishes a failed coverage read from an empty one and retries", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveRetry!: (sessions: []) => void;
    listUncoveredSessionsAction
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    render(<LeaveDecisionControls requestId="r1" />);

    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(listUncoveredSessionsAction).toHaveBeenCalledTimes(1);
    expect(listUncoveredSessionsAction).toHaveBeenNthCalledWith(1, { requestId: "r1" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { rejectFirst(new Error("offline")); });
    await waitFor(() =>
      expect(screen.getByText(/could not check coverage/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/none — no sessions/i)).toBeNull();

    const retry = screen.getByRole("button", { name: /retry/i }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    fireEvent.click(retry);
    expect(listUncoveredSessionsAction).toHaveBeenCalledTimes(2);
    expect(listUncoveredSessionsAction).toHaveBeenNthCalledWith(2, { requestId: "r1" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/none — no sessions/i)).toBeNull();
    await act(async () => { resolveRetry([]); });
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
    await waitFor(() => expect((screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/did not reach the server/i),
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
