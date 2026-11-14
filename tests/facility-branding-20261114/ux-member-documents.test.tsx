// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
import { MemberDocumentsPanel } from "@/components/member-detail/member-documents-panel";
afterEach(cleanup);
it("does not promote unavailable documents in normal navigation", () => {
  render(<MemberDetailTabs memberId="member" active="overview" facilityScope="site" />);
  expect(within(screen.getByRole("navigation", { name: "Member sections" })).queryByRole("link", { name: "Documents" })).toBeNull();
  expect(screen.getByRole("link", { name: "Documents" })).toBeTruthy();
});
it("keeps direct documents links understandable and returnable", () => {
  render(<><MemberDetailTabs memberId="member" active="documents" facilityScope="site" /><MemberDocumentsPanel /></>);
  expect(screen.getByText(/uploads aren.t available/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toContain("facility=site");
});
