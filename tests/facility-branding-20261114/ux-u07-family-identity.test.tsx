// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SelfHome } from "@/components/self-home";

afterEach(cleanup);
it("keeps same-name children and their actions in their own rows", () => {
  render(<SelfHome audience="guardian" scopeKind="self_session" tenantId="club-a" guideKey="opaque-key" view={{ clubName: "Test club", audience: "guardian", entries: [
    { memberId: "child-a", fullName: "Alex", memberCode: "A-1", status: "active", facilityName: "North" },
    { memberId: "child-b", fullName: "Alex", memberCode: "B-2", status: "active", facilityName: "South" },
  ] }} />);
  const first = screen.getByText("Member code A-1").closest("li");
  const second = screen.getByText("Member code B-2").closest("li");
  if (!first || !second) throw new Error("Membership rows missing");
  expect(within(first).getByRole("link", { name: /fees and payments for alex, member code a-1/i }).getAttribute("href")).toBe("/family/billing/child-a");
  expect(within(second).getByRole("link", { name: /achievements page for alex, member code b-2/i }).getAttribute("href")).toBe("/family/showcase/child-b");
  expect(screen.queryByText(/pay now/i)).toBeNull();
});
