import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberList } from "@/components/member-list";
import type { MemberListRow } from "@/lib/services/people";

it("identifies directory columns and keeps a member-specific scoped link", () => {
  const row: MemberListRow = { memberId: "member-1", personId: "person-1", fullName: "A Person", memberCode: "M1", locationId: "site", locationName: "North", status: "active", phone: null, isMinor: false, createdAt: "2026-01-01", joinedOn: "2026-01-01" };
  const html = renderToStaticMarkup(<MemberList members={[row]} memberTerm={{ one: "member", other: "members" }} statusLabels={{ active: "Active" }} emptyKind="empty" onClearFilters={() => {}} scopeQuery="?facility=site" onOpen={() => {}} isPending={false} canWrite />);
  expect(html).toContain("Member");
  expect(html).toContain("Club");
  expect(html).toContain("Status");
  expect(html).toContain("/owner/members/member-1?facility=site");
  expect(html).toContain("North");
});
