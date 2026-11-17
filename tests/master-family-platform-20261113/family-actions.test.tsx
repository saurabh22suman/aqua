// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/components/self-sign-out", () => ({ SelfSignOut: () => <button>Leave family view</button> }));
import { SelfHome } from "@/components/self-home";

afterEach(cleanup);
it("gives each child's actions distinct accessible names and correct destinations", () => {
  const entries = [
    { memberId: "child-a", fullName: "Aarav Example", memberCode: "AAA001", status: "active", facilityName: "North" },
    { memberId: "child-b", fullName: "Anika Example", memberCode: "BBB002", status: "paused", facilityName: "South" },
  ];
  render(<SelfHome view={{ clubName: "Example Club", audience: "guardian", entries }} audience="guardian" scopeKind="self_session" tenantId="synthetic-club" />);
  for (const child of entries) {
    const row = screen.getByText(child.fullName).closest("li");
    expect(row).not.toBeNull();
    const fees = within(row!).getByRole("link", { name: `Fees and payments for ${child.fullName}` });
    const achievements = within(row!).getByRole("link", { name: `Achievements page for ${child.fullName}` });
    expect(fees.getAttribute("href")).toBe(`/family/billing/${child.memberId}`);
    expect(achievements.getAttribute("href")).toBe(`/family/showcase/${child.memberId}`);
  }
});

it("does not offer a member billing link without billing permission", () => {
  render(<SelfHome view={{ clubName: "Example Club", audience: "member", entries: [{ memberId: "self", fullName: "Member Example", memberCode: "SELF01", status: "active", facilityName: null }] }} audience="member" scopeKind="self_session" tenantId="synthetic-club" canViewOwnBilling={false} />);
  expect(screen.queryByRole("link", { name: /fees and payments/i })).toBeNull();
  expect(screen.getByText(/linked guardian can view fees/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Your achievements page" }).getAttribute("href")).toBe("/member/showcase");
});

it("distinguishes actions when two children have the same name", () => {
  const entries = [
    { memberId: "child-a", fullName: "Sam Example", memberCode: "AAA001", status: "active", facilityName: "North" },
    { memberId: "child-b", fullName: "Sam Example", memberCode: "BBB002", status: "paused", facilityName: "South" },
  ];
  render(<SelfHome view={{ clubName: "Example Club", audience: "guardian", entries }} audience="guardian" scopeKind="self_session" tenantId="synthetic-club" />);
  for (const child of entries) {
    expect(screen.getByRole("link", { name: `Fees and payments for ${child.fullName}, member code ${child.memberCode}` }).getAttribute("href")).toBe(`/family/billing/${child.memberId}`);
    expect(screen.getByRole("link", { name: `Achievements page for ${child.fullName}, member code ${child.memberCode}` }).getAttribute("href")).toBe(`/family/showcase/${child.memberId}`);
  }
});
