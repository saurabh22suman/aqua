// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ subscriptions: vi.fn(), plans: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/people", () => ({ transitionMemberStatusAction: vi.fn() }));
vi.mock("@/lib/actions/subscriptions", () => ({ listMemberSubscriptionsAction: actions.subscriptions, createSubscriptionAction: vi.fn(), cancelSubscriptionAction: vi.fn(), pauseSubscriptionAction: vi.fn(), resumeSubscriptionAction: vi.fn() }));
vi.mock("@/lib/actions/membership-plans", () => ({ listPlansAction: actions.plans }));
import { MemberStatusPanel } from "@/components/member-status-panel";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("states the participation and paid-plan distinction once alongside both available controls", async () => {
  actions.subscriptions.mockResolvedValue([]);
  actions.plans.mockResolvedValue([]);
  render(<><MemberStatusPanel memberId="m1" status="active" canWrite /><MemberSubscriptionPanel memberId="m1" canManage /></>);
  await screen.findByRole("heading", { name: "Paid plan" });
  expect(screen.getAllByText(/pausing one does not pause the other/i)).toHaveLength(1);
  expect(screen.getByRole("button", { name: /move to paused/i })).toBeTruthy();
  expect(screen.getByText(/no subscription yet/i)).toBeTruthy();
});

it("retains the distinction when plan data cannot load", async () => {
  actions.subscriptions.mockRejectedValue(new Error("unavailable"));
  actions.plans.mockResolvedValue([]);
  render(<><MemberStatusPanel memberId="m1" status="active" canWrite /><MemberSubscriptionPanel memberId="m1" canManage /></>);
  await waitFor(() => expect(screen.getByText("Could not load plans.")).toBeTruthy());
  expect(screen.getAllByText(/pausing one does not pause the other/i)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

it("retains the distinction while plan data is loading, including for readers", () => {
  actions.subscriptions.mockReturnValue(new Promise(() => {}));
  actions.plans.mockResolvedValue([]);
  render(<><MemberStatusPanel memberId="m1" status="active" canWrite={false} /><MemberSubscriptionPanel memberId="m1" canManage={false} /></>);
  expect(screen.getAllByText(/pausing one does not pause the other/i)).toHaveLength(1);
  expect(screen.getByText("Loading plans…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /move to paused/i })).toBeNull();
});
