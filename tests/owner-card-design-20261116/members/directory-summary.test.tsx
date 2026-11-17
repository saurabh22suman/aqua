import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemberListRow } from "@/lib/services/people";
vi.mock("@/lib/actions/people", () => ({ listMembersAction: vi.fn() }));
import { MembersBoard } from "@/components/members-board";

it("shows facility-scoped directory counts from actual initial rows", () => {
  const rows = ["active", "active", "paused"].map((status, index) => ({
    memberId: `m${index}`, personId: `p${index}`, fullName: `Person ${index}`, memberCode: `M${index}`,
    locationId: "site", locationName: "North", status, phone: null, isMinor: false, createdAt: "2026-01-01", joinedOn: "2026-01-01",
  })) as MemberListRow[];
  const html = renderToStaticMarkup(<MembersBoard initialMembers={rows} initialLocationId="site" />);
  expect(html).toContain('aria-label="Member results"');
  expect(html).toMatch(/>3<\/strong> matching/);
  expect(html).toMatch(/>2<\/strong> active/);
  expect(html).toMatch(/>1<\/strong> paused/);
  expect(html).toContain("facility=site");
});
