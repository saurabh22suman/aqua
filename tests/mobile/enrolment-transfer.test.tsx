// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.6 (docs/five-day-work-guide.md) — batch transfer UI on the member
// enrolment panel. Service/action shipped earlier; the surface is the
// missing half. The work-guide text says "preserving ... the
// subscription"; no subscription table exists yet (C-30), so the
// transfer moves the enrolment only — noted in the service. TDD.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const transferMemberToBatchAction = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "ok" as const,
    fromBatchId: "b1",
    toBatchId: "b2",
  })),
);
vi.mock("@/lib/actions/transfer", () => ({ transferMemberToBatchAction }));
vi.mock("@/lib/actions/waitlist", () => ({
  addToWaitlistAction: vi.fn(),
  promoteHeadAction: vi.fn(),
  cancelWaitlistAction: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: vi.fn(async () => [
    { id: "b1", name: "Junior TTS", capacity: 10, programName: "Learn to swim" },
    { id: "b2", name: "Evening Juniors", capacity: 10, programName: "Learn to swim" },
  ]),
}));
vi.mock("@/lib/actions/enrolment", () => ({
  listMemberEnrolmentsAction: vi.fn(async () => [
    { batchId: "b1", batchName: "Junior TTS", programName: "Learn to swim" },
  ]),
  enrolMemberAction: vi.fn(),
}));

import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemberEnrolmentPanel transfer (R.6)", () => {
  it("moves a member to another batch through the action", async () => {
    render(<MemberEnrolmentPanel memberId="m1" terminology={TERMINOLOGY} />);

    fireEvent.click(await screen.findByRole("button", { name: /^transfer$/i }));
    fireEvent.change(screen.getByTestId("transfer-target"), {
      target: { value: "b2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));

    await vi.waitFor(() =>
      expect(transferMemberToBatchAction).toHaveBeenCalledWith({
        memberId: "m1",
        fromBatchId: "b1",
        toBatchId: "b2",
      }),
    );
  });

  it("surfaces a full destination batch", async () => {
    transferMemberToBatchAction.mockResolvedValueOnce({
      kind: "error",
      code: "target_full",
      message: "Destination batch is full.",
    } as never);

    render(<MemberEnrolmentPanel memberId="m1" terminology={TERMINOLOGY} />);
    fireEvent.click(await screen.findByRole("button", { name: /^transfer$/i }));
    fireEvent.change(screen.getByTestId("transfer-target"), {
      target: { value: "b2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Destination batch is full"),
    );
  });
});
