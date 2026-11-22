import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/subscriptions", () => ({}));
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";

it("defers the start form until the owner chooses to start a plan", () => {
  const html = renderToStaticMarkup(<MemberSubscriptionPanel memberId="m" canManage compact initialData={{ memberId: "m", subscriptions: [], plans: [{ id: "p", name: "Monthly", kind: "duration", durationDays: 30, sessions: null, locationId: "l", locationName: "Club", activityId: null, activityName: null, isActive: true, sourceShapeId: null, createdAt: "2026-01-01", amountPaise: 10000 }] }} />);
  expect(html).toContain("No subscription yet");
  expect(html).toContain("Start a subscription");
  expect(html).not.toContain("Starts (optional)");
});
