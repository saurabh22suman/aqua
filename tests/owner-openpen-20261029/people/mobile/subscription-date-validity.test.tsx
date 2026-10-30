// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Date validity guard regression (enabled after shared API transfer).
// The shared DateField currently emits "" for invalid/partial text, which is
// indistinguishable from a deliberately empty optional date. Until the system
// transfers the additive onValidityChange/native-validity API, a held
// subscription must not be started from visibly invalid text.
//
// Run this file with `describe` (not skip) once the API arrives, then implement
// the starts/ends validity guard. It was run unskipped on 29 Oct 2026 and
// failed: invalid/partial text still enabled Start and submitted default-today.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const createSubscriptionAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: async () => [],
  createSubscriptionAction,
  cancelSubscriptionAction: vi.fn(),
  pauseSubscriptionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: async () => [
    {
      id: "plan-1",
      name: "Monthly",
      kind: "duration",
      amountPaise: 280000,
      durationDays: 30,
      sessions: null,
      locationId: "loc-1",
      locationName: "Worli Main",
      activityId: null,
      activityName: null,
      isActive: true,
    },
  ],
}));

import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

async function renderPanel() {
  render(<MemberSubscriptionPanel memberId="m1" canManage />);
  await waitFor(() => expect(document.body.textContent).toContain("Monthly"));
}

function startButton() {
  return screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement;
}

describe("held: optional subscription dates block invalid/partial text", () => {
  it("blocks a complete invalid start date with a message and disabled action", async () => {
    createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
    await renderPanel();
    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    fireEvent.change(starts, { target: { value: "31/02/2027" } });

    expect(screen.getAllByText(/enter a real date/i).length).toBeGreaterThan(0);
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    expect(createSubscriptionAction).not.toHaveBeenCalled();
  });

  it("blocks partial start text", async () => {
    createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
    await renderPanel();
    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    fireEvent.change(starts, { target: { value: "12/" } });

    expect(screen.getAllByText(/enter a real date/i).length).toBeGreaterThan(0);
    expect(startButton().disabled).toBe(true);
    expect(createSubscriptionAction).not.toHaveBeenCalled();
  });

  it("blocks invalid or partial end text", async () => {
    createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
    await renderPanel();
    const ends = screen.getByLabelText("Ends (optional)") as HTMLInputElement;
    fireEvent.change(ends, { target: { value: "31/02/2027" } });

    expect(screen.getAllByText(/enter a real date/i).length).toBeGreaterThan(0);
    expect(startButton().disabled).toBe(true);
    expect(createSubscriptionAction).not.toHaveBeenCalled();
  });

  it("clears stale ISO text when a valid date becomes invalid and does not mutate", async () => {
    createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
    await renderPanel();
    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    fireEvent.change(starts, { target: { value: "15/01/2027" } });
    fireEvent.change(starts, { target: { value: "31/02/2027" } });

    expect(startButton().disabled).toBe(true);
    expect(createSubscriptionAction).not.toHaveBeenCalled();
  });

  it("still permits default-today when the optional date is deliberately blank", async () => {
    createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
    await renderPanel();
    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    fireEvent.change(starts, { target: { value: "31/02/2027" } });
    fireEvent.change(starts, { target: { value: "" } });

    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    await waitFor(() => expect(createSubscriptionAction).toHaveBeenCalled());
    const payload = createSubscriptionAction.mock.calls[0]![0] as {
      startsOn?: string;
    };
    expect(payload.startsOn).toBeUndefined();
  });
});
