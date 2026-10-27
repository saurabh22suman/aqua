// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ pathname: "/owner/batches/batch-1", search: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: state.search }));
import { findActiveHref } from "@/components/bottom-nav";
import { OwnerShellCrumb } from "@/components/owner-shell-crumb";
import { OwnerSideNav } from "@/components/owner-side-nav";
import { OWNER_SIDEBAR_GROUPS } from "@/lib/nav";
import { CafeMemberPicker } from "@/components/cafe-member-picker";

const items = OWNER_SIDEBAR_GROUPS.flatMap(group => group.items);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("combined owner QA — navigation and member picker", () => {
  it("maps a batch detail to its Programs destination in crumb and sidebar", () => {
    render(<><OwnerShellCrumb items={items} /><OwnerSideNav /></>);
    expect(screen.getByTestId("owner-shell-crumb").textContent).toContain("Programs & batches");
    expect(screen.getByRole("link", { name: "Programs & batches" }).getAttribute("aria-current")).toBe("page");
  });
  it("does not invent a Programs destination when that item is permission-filtered out", () => {
    expect(findActiveHref("/owner/batches/batch-1", items.filter(item => item.href !== "/owner/programs"))).toBeNull();
    expect(findActiveHref("/owner/batches-unrelated/batch-1", items)).toBeNull();
    expect(findActiveHref("/owner/members/member-1/edit", items)).toBe("/owner/members");
    expect(findActiveHref("/coach", items)).toBeNull();
  });
  it("labels member search independently from its Search button and preserves Enter/results/selection", async () => {
    state.search.mockResolvedValue([{ memberId: "member-1", fullName: "Synthetic Swimmer", memberCode: "S001" }]);
    const select = vi.fn();
    render(<CafeMemberPicker member={null} terminology={{locale:"en", overrides:{}}} onSelect={select} />);
    const input = screen.getByRole("textbox", { name: "Member (optional)" });
    fireEvent.change(input, {target:{value:" Synthetic "}});
    fireEvent.keyDown(input, {key:"Enter"});
    await waitFor(() => expect(state.search).toHaveBeenCalledWith({search:"Synthetic"}));
    fireEvent.click(await screen.findByTestId("cafe-member-option-member-1"));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({memberId:"member-1"}));
  });
});
