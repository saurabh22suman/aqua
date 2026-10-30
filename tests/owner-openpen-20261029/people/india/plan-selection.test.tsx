// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// India simplification item 7 — the subscription plan picker must select from
// the same eligible duration/term/sessions array it renders. An invoice-only
// first row must not become the default.

const listPlansAction = vi.hoisted(() => vi.fn());
const listMemberSubscriptionsAction = vi.hoisted(() => vi.fn());
const createSubscriptionAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: (...args: unknown[]) => listPlansAction(...args),
}));
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: (...args: unknown[]) => listMemberSubscriptionsAction(...args),
  createSubscriptionAction: (...args: unknown[]) => createSubscriptionAction(...args),
  cancelSubscriptionAction: vi.fn(),
  pauseSubscriptionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-duration",
    name: "Monthly",
    kind: "duration",
    durationDays: 30,
    sessions: null,
    amountPaise: 280000,
    locationId: "loc-1",
    locationName: "Worli Main",
    activityId: null,
    activityName: null,
    isActive: true,
    sourceShapeId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const INVOICE_ONLY = plan({
  id: "plan-invoice",
  name: "One-time invoice item",
  kind: "one_time",
  durationDays: null,
});
const DURATION = plan();
const SESSIONS = plan({
  id: "plan-sessions",
  name: "10 sessions",
  kind: "sessions",
  durationDays: null,
  sessions: 10,
  amountPaise: 350000,
});

beforeEach(() => {
  listMemberSubscriptionsAction.mockResolvedValue([]);
  listPlansAction.mockResolvedValue([INVOICE_ONLY, DURATION, SESSIONS]);
  createSubscriptionAction.mockResolvedValue({ ok: true, id: "sub-new" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function picker() {
  return document.getElementById("member-subscription-plan") as HTMLSelectElement;
}

describe("subscription plan selection", () => {
  it("defaults to the first eligible plan, never an invoice-only first row", async () => {
    render(<MemberSubscriptionPanel memberId="m1" canManage />);
    await waitFor(() => expect(picker()).toBeTruthy());
    await waitFor(() => expect(listPlansAction).toHaveBeenCalled());

    expect(picker().value).toBe(DURATION.id);
    expect(Array.from(picker().options).map((o) => o.value)).toEqual([
      DURATION.id,
      SESSIONS.id,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));
    await waitFor(() =>
      expect(createSubscriptionAction).toHaveBeenCalledWith(
        expect.objectContaining({ planId: DURATION.id }),
      ),
    );
  });

  it("preserves an explicitly selected still-eligible plan and replaces a stale one", async () => {
    listPlansAction
      .mockResolvedValueOnce([INVOICE_ONLY, DURATION, SESSIONS])
      .mockResolvedValueOnce([INVOICE_ONLY, DURATION]);
    render(<MemberSubscriptionPanel memberId="m1" canManage />);
    await waitFor(() => expect(picker().value).toBe(DURATION.id));

    fireEvent.change(picker(), { target: { value: SESSIONS.id } });
    expect(picker().value).toBe(SESSIONS.id);
    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));

    await waitFor(() =>
      expect(createSubscriptionAction).toHaveBeenCalledWith(
        expect.objectContaining({ planId: SESSIONS.id }),
      ),
    );
    await waitFor(() => expect(listPlansAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(picker().value).toBe(DURATION.id));
  });

  it("shows an explicit empty state and a disabled Start when no plan is eligible", async () => {
    listPlansAction.mockResolvedValue([INVOICE_ONLY]);
    render(<MemberSubscriptionPanel memberId="m1" canManage />);
    await waitFor(() => expect(listPlansAction).toHaveBeenCalled());

    expect(document.body.textContent).toMatch(/no eligible membership plan/i);
    const start = screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(createSubscriptionAction).not.toHaveBeenCalled();
  });
});
