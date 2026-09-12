// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.5 (docs/five-day-work-guide.md) — waitlist queue UI on the batch
// detail page. The service/actions shipped earlier; the queue surface
// is the missing half. TDD: fails before the component exists.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const promoteHeadAction = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "ok" as const, entryId: "w1", position: 1 })),
);
const cancelWaitlistAction = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "ok" as const, entryId: "w1", position: 1 })),
);
vi.mock("@/lib/actions/waitlist", () => ({
  promoteHeadAction,
  cancelWaitlistAction,
  addToWaitlistAction: vi.fn(),
}));

import { WaitlistBoard } from "@/components/waitlist-board";

const ROWS = [
  {
    entryId: "w1",
    memberId: "m1",
    memberName: "Aadhya Sharma",
    memberCode: "AWS-010",
    position: 1,
    requestedAt: "2026-09-10T06:00:00.000Z",
  },
  {
    entryId: "w2",
    memberId: "m2",
    memberName: "Vivaan Iyer",
    memberCode: "AWS-011",
    position: 2,
    requestedAt: "2026-09-11T06:00:00.000Z",
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WaitlistBoard (R.5)", () => {
  it("lists the queue in position order with names and codes", () => {
    render(<WaitlistBoard batchId="b1" initialRows={ROWS} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Aadhya Sharma");
    expect(text).toContain("AWS-010");
    expect(text).toContain("Vivaan Iyer");
    expect(text).toContain("#1");
    expect(text).toContain("#2");
  });

  it("shows an empty state when nobody is waiting", () => {
    render(<WaitlistBoard batchId="b1" initialRows={[]} />);
    expect(document.body.textContent).toContain("No one is waiting");
  });

  it("promotes the head through the action", async () => {
    render(<WaitlistBoard batchId="b1" initialRows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: /promote next/i }));
    await vi.waitFor(() =>
      expect(promoteHeadAction).toHaveBeenCalledWith({ batchId: "b1" }),
    );
  });

  it("removes a member from the queue through the action", async () => {
    render(<WaitlistBoard batchId="b1" initialRows={ROWS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]!);
    await vi.waitFor(() =>
      expect(cancelWaitlistAction).toHaveBeenCalledWith({
        memberId: "m1",
        batchId: "b1",
      }),
    );
  });
});
