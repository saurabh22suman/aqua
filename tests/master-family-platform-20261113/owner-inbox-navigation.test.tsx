// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/inbox" }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => <button>Sign out</button> }));
import { ownerNavForPermissions, ownerSidebarGroupsForPermissions } from "@/lib/nav";
import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { OwnerSideNav } from "@/components/owner-side-nav";
afterEach(cleanup);
const readers = [
  ["manager", ["members.read", "invoices.read", "enquiries.read", "staff.read", "programs.read", "reports.operational"]],
  ["accountant", ["members.read", "invoices.read", "reports.operational"]],
] as const;
describe("recipient-only owner-surface announcement navigation", () => {
  it.each(readers)("gives %s a desktop inbox without the composer grant", (_role, grants) => {
    const permissions = new Set<string>(grants);
    render(<OwnerSideNav groups={ownerSidebarGroupsForPermissions(permissions)} />);
    expect(screen.getByRole("link", { name: "Announcements inbox" }).getAttribute("href")).toBe("/owner/inbox");
    expect(screen.queryByRole("link", { name: "Announcements" })).toBeNull();
    expect(permissions.has("messaging.send")).toBe(false);
  });
  it.each(readers)("lets %s open the inbox from mobile More without a fifth tab", async (_role, grants) => {
    const permissions = new Set<string>(grants);
    render(<OwnerMobileNav navItems={ownerNavForPermissions(permissions)} sidebarGroups={ownerSidebarGroupsForPermissions(permissions)} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(Array.from(nav.children).filter(element => element.tagName === "A")).toHaveLength(3);
    fireEvent.click(screen.getByText("More", { exact: true }));
    expect(within(nav).getByRole("link", { name: "Announcements inbox" }).getAttribute("href")).toBe("/owner/inbox");
  });
  it("keeps the personal inbox reachable when a custom sender lacks roster-read permission", () => {
    render(<OwnerSideNav groups={ownerSidebarGroupsForPermissions(new Set(["messaging.send"]))} />);
    expect(screen.getByRole("link", { name: "Announcements inbox" }).getAttribute("href")).toBe("/owner/inbox");
  });
  it("keeps authorized senders on their existing compose-and-inbox destination", () => {
    const permissions = new Set(["messaging.send", "members.read"]);
    render(<OwnerSideNav groups={ownerSidebarGroupsForPermissions(permissions)} />);
    expect(screen.getByRole("link", { name: "Announcements" }).getAttribute("href")).toBe("/owner/announcements");
    expect(screen.queryByRole("link", { name: "Announcements inbox" })).toBeNull();
  });
});
