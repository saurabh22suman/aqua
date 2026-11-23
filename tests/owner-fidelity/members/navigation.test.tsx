// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/members/m" }));
afterEach(cleanup);

it("keeps notes in More and exposes authorized family access alongside the tabs", () => {
  render(<MemberDetailTabs memberId="member-1" active="overview" facilityScope="site" accessHref="/owner/members/member-1/access?facility=site" />);
  const nav = screen.getByRole("navigation", { name: "Member sections" });
  expect(within(nav).getByRole("link", { name: "Fees" }).getAttribute("href")).toBe("/owner/members/member-1?tab=payments&facility=site");
  fireEvent.click(within(nav).getByText("More"));
  expect(within(nav).getByRole("link", { name: "Notes" }).getAttribute("href")).toBe("/owner/members/member-1?tab=notes&facility=site");
  expect(within(nav).queryByRole("link", { name: "Documents" })).toBeNull();
  expect(within(nav).getByRole("link", { name: "Member and family access" }).getAttribute("href")).toBe("/owner/members/member-1/access?facility=site");
});

it("dismisses More with Escape and returns focus to its trigger", () => {
  render(<MemberDetailTabs memberId="m" active="overview" />);
  const trigger = screen.getByText("More");
  fireEvent.click(trigger);
  expect(trigger.closest("details")?.open).toBe(true);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger.closest("details")?.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("dismisses More after an outside press or selecting a destination", () => {
  render(<><MemberDetailTabs memberId="m" active="overview" /><button>Outside</button></>);
  const trigger = screen.getByText("More");
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByText("Outside"));
  expect(trigger.closest("details")?.open).toBe(false);
  fireEvent.click(trigger);
  const notes = screen.getByRole("link", { name: "Notes" });
  notes.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(notes);
  expect(trigger.closest("details")?.open).toBe(false);
});

it("closes More when the selected member section changes", () => {
  const { rerender } = render(<MemberDetailTabs memberId="m" active="overview" facilityScope="all" />);
  fireEvent.click(screen.getByText("More"));
  rerender(<MemberDetailTabs memberId="m" active="notes" facilityScope="all" />);
  expect(screen.getByText("More").closest("details")?.open).toBe(false);
});

it("does not show family access without authorization", () => {
  render(<MemberDetailTabs memberId="m" active="notes" facilityScope="all" />);
  fireEvent.click(screen.getByText("More"));
  expect(screen.queryByRole("link", { name: "Member and family access" })).toBeNull();
  expect(screen.getByRole("link", { name: "Notes" }).getAttribute("aria-current")).toBe("page");
});
