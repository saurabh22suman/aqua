// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.5 — when enrolment is refused because the batch is full, the
// member detail enrolment panel offers "Join waitlist" instead of
// leaving the user at a dead end. TDD: fails before the panel change.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const addToWaitlistAction = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "ok" as const, entryId: "w1", position: 1 })),
);
vi.mock("@/lib/actions/waitlist", () => ({
  addToWaitlistAction,
  promoteHeadAction: vi.fn(),
  cancelWaitlistAction: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: vi.fn(async () => [
    {
      id: "b1",
      name: "Junior TTS",
      capacity: 10,
      programName: "Learn to swim",
      coachName: null,
      locationName: "Worli Main",
      daysOfWeek: [1, 3, 5],
      startTime: "07:00:00",
      endTime: "08:00:00",
    },
  ]),
}));
vi.mock("@/lib/actions/enrolment", () => ({
  listMemberEnrolmentsAction: vi.fn(async () => []),
  enrolMemberAction: vi.fn(async () => ({
    ok: false,
    error: "This batch is full (capacity 10).",
  })),
}));

import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemberEnrolmentPanel full-batch waitlist CTA (R.5)", () => {
  it("offers Join waitlist after a capacity refusal and calls the action", async () => {
    render(<MemberEnrolmentPanel memberId="m1" terminology={TERMINOLOGY} />);

    const enrol = await screen.findByRole("button", { name: /^enrol$/i });
    fireEvent.click(enrol);

    const waitlist = await screen.findByRole("button", {
      name: /join waitlist/i,
    });
    fireEvent.click(waitlist);

    await vi.waitFor(() =>
      expect(addToWaitlistAction).toHaveBeenCalledWith({
        memberId: "m1",
        batchId: "b1",
      }),
    );
  });
});
