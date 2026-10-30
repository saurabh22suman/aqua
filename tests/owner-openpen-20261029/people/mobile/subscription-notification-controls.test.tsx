// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner mobile controls — intended RED.
// Auto-renew must be one associated 44px label row with a 20px accent checkbox.
// Notification destinations already have 48px labels but need the same accent.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: async () => [],
  createSubscriptionAction: vi.fn(),
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
vi.mock("@/lib/actions/notification-destinations", () => ({
  saveNotificationDestinationsAction: vi.fn(),
}));

import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { createSubscriptionAction } from "@/lib/actions/subscriptions";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

describe("auto-renew checkbox row", () => {
  it("is a full 44px associated label with a 20px accent checkbox", async () => {
    render(<MemberSubscriptionPanel memberId="m1" canManage />);

    await waitFor(() => expect(document.body.textContent).toContain("Monthly"));
    const input = document.getElementById(
      "member-subscription-auto-renew",
    ) as HTMLInputElement;
    const label = input.closest("label");

    expect(label).toBeTruthy();
    expect(label!.className).toContain("min-h-11");
    expect(label!.contains(input)).toBe(true);
    expect(input.className).toContain("h-5");
    expect(input.className).toContain("w-5");
    expect(input.className).toContain("accent-[var(--accent-strong)]");

    fireEvent.click(label!);
    expect(input.checked).toBe(true);
    expect(document.body.textContent).toContain("payments stay manual");
  });
});

describe("subscription date controls", () => {
  it("uses the shared day-first DateField for starts and ends", async () => {
    render(<MemberSubscriptionPanel memberId="m1" canManage />);
    await waitFor(() => expect(document.body.textContent).toContain("Monthly"));

    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    const ends = screen.getByLabelText("Ends (optional)") as HTMLInputElement;
    for (const field of [starts, ends]) {
      expect(field.type).toBe("text");
      expect(field.inputMode).toBe("numeric");
      expect(field.placeholder).toBe("dd/mm/yyyy");
      expect(field.getAttribute("aria-describedby")).toContain("format");
    }
  });

  it("submits a typed valid ISO date", async () => {
    vi.mocked(createSubscriptionAction).mockResolvedValue({ ok: true, id: "sub-new" });
    render(<MemberSubscriptionPanel memberId="m1" canManage />);
    await waitFor(() => expect(document.body.textContent).toContain("Monthly"));

    const starts = screen.getByLabelText("Starts (optional)") as HTMLInputElement;
    fireEvent.change(starts, { target: { value: "15/01/2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));

    await waitFor(() =>
      expect(createSubscriptionAction).toHaveBeenCalledWith(
        expect.objectContaining({ startsOn: "2027-01-15" }),
      ),
    );
  });

});

describe("notification destination checkbox", () => {
  it("uses the owner accent token and keeps the 48px label row", () => {
    render(
      <MemberNotificationDestinations
        memberId="m1"
        communicationsAllowed={false}
        minor={false}
        contacts={[
          {
            personId: "p1",
            name: "Aanya Rao",
            relationship: "Guardian",
            phone: "+919000000101",
            selected: false,
          },
        ]}
      />,
    );

    const input = screen.getByRole("checkbox") as HTMLInputElement;
    const label = input.closest("label");
    expect(label!.className).toContain("min-h-[48px]");
    expect(label!.contains(input)).toBe(true);
    expect(input.className).toContain("accent-[var(--accent-strong)]");
    fireEvent.click(label!);
    expect(input.checked).toBe(true);
    expect(document.body.textContent).toContain("Optional student updates");
  });
});
