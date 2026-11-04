// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/people", () => ({ listMembersAction: vi.fn(async () => []) }));
import { MembersBoard } from "@/components/members-board";
import type { MemberListRow } from "@/lib/services/people";
const base: MemberListRow = { memberId: "m1", personId: "p1", fullName: "Test One", phone: null, memberCode: "M-01", status: "active", locationId: "loc1", locationName: "Main", isMinor: false, createdAt: "2026-10-01T00:00:00Z", joinedOn: "2026-10-01" };
afterEach(cleanup);
it("shows identity, status and facility without empty phone or repeated joining date", () => {
  render(<MembersBoard initialMembers={[base, { ...base, memberId: "m2", personId: "p2", fullName: "Test Two", memberCode: "M-02", status: "paused", phone: "+919876543210" }]} />);
  const rows = screen.getAllByTestId("member-row");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Test One")).toBeTruthy();
  expect(within(rows[0]).getByText("Active")).toBeTruthy();
  expect(rows[0].textContent).toContain("M-01");
  expect(rows[0].textContent).toContain("Main");
  expect(rows[0].textContent).not.toMatch(/phone|member since|1 oct 2026/i);
  // The row keeps the directory's scope: an all-facilities
  // directory says so explicitly, so a remembered facility cookie can
  // never narrow it.
  expect(rows[0].getAttribute("href")).toBe("/owner/members/m1?facility=all");
  expect(within(rows[1]).getByText("Paused")).toBeTruthy();
  expect(rows[1].textContent).toMatch(/98765/);
  expect(rows[1].textContent).not.toMatch(/member since|1 oct 2026/i);
});
