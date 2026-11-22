// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRow } from "@/lib/services/membership-plans";
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/lib/actions/subscriptions", () => ({
  cancelSubscriptionAction: vi.fn(), createSubscriptionAction: vi.fn(), listMemberSubscriptionsAction: vi.fn(),
  listMemberSubscriptionPlansAction: vi.fn(), pauseSubscriptionAction: vi.fn(), resumeSubscriptionAction: vi.fn(),
}));
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
afterEach(() => {cleanup(); vi.useRealTimers();});
it("distinguishes same-name plans by entitlement and authorized site without starting a subscription", () => {
  const base = {name:"Standard", amountPaise:200000, activityId:null, activityName:null, isActive:true, sourceShapeId:null, createdAt:"2026-11-01T00:00:00Z"};
  const plans: PlanRow[] = [
    {...base,id:"p1",kind:"duration",durationDays:30,sessions:null,locationId:"a",locationName:"Site A"},
    {...base,id:"p2",kind:"sessions",durationDays:null,sessions:12,locationId:"b",locationName:"Site B"},
  ];
  render(<MemberSubscriptionPanel memberId="m" canManage initialData={{memberId:"m",subscriptions:[],plans}} />);
  expect(screen.getByRole("heading",{name:"Membership plan"})).toBeTruthy();
  expect(screen.getByRole("option",{name:/Standard.*30 days.*Site A/i})).toBeTruthy();
  expect(screen.getByRole("option",{name:/Standard.*12 classes.*Site B/i})).toBeTruthy();
  expect(screen.getByText(/does not record a payment or automatically issue its first invoice/i)).toBeTruthy();
});
it("previews the exact inclusive plan dates without creating or paying for a subscription", () => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2024-02-01T06:00:00Z"));
  const plans:PlanRow[] = [{id:"p1",name:"Monthly",amountPaise:200000,activityId:null,activityName:null,isActive:true,sourceShapeId:null,createdAt:"2024-01-01T00:00:00Z",kind:"duration",durationDays:30,sessions:null,locationId:"a",locationName:"Site A"}];
  render(<MemberSubscriptionPanel memberId="m" canManage initialData={{memberId:"m",subscriptions:[],plans}} />);
  expect(screen.getByText(/1 Feb 2024.*1 Mar 2024/i)).toBeTruthy();
});
it("honours a deliberately chosen end date in the preview", async () => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2024-02-01T06:00:00Z"));
  const plans:PlanRow[] = [{id:"p1",name:"Monthly",amountPaise:200000,activityId:null,activityName:null,isActive:true,sourceShapeId:null,createdAt:"2024-01-01T00:00:00Z",kind:"duration",durationDays:30,sessions:null,locationId:"a",locationName:"Site A"}];
  render(<MemberSubscriptionPanel memberId="m" canManage initialData={{memberId:"m",subscriptions:[],plans}} />);
  fireEvent.change(screen.getByLabelText("Ends (optional)"),{target:{value:"10/04/2024"}});
  expect(await screen.findByText(/1 Feb 2024.*10 Apr 2024/i)).toBeTruthy();
});
