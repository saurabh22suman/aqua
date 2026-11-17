// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Fragment, type ComponentType, type ReactNode } from "react";

const state = vi.hoisted(() => ({ query: "facility=all", pathname: "/owner/members" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
import { OwnerSideNav } from "@/components/owner-side-nav";
import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { scopedOwnerNavigationHref } from "@/components/owner-ui/owner-facility-navigation";
import * as scope from "@/components/owner-ui/owner-navigation-scope";
import type { NavItem } from "@/components/bottom-nav";
import type { OwnerSidebarGroup } from "@/lib/nav";

const groups: OwnerSidebarGroup[] = [{ label: "Navigation", items: [
  { href: "/owner", label: "Home", iconName: "layout-dashboard", exact: true },
  { href: "/owner/members?tab=active#list", label: "Directory", iconName: "users" },
  { href: "/owner/schedule", label: "Schedule", iconName: "calendar-days" },
  { href: "/owner/sessions", label: "Sessions", iconName: "calendar-days" },
  { href: "/owner/fees?facility=22222222-2222-4222-8222-222222222222&tab=dues#top", label: "Scoped fees", iconName: "receipt" },
  { href: "/owner/settings", label: "Settings", iconName: "settings" },
  { href: "/login", label: "Login", iconName: "settings" },
  { href: "https://example.com/owner/members", label: "External", iconName: "settings" },
] }];
afterEach(cleanup);

it("preserves explicit all independently of a stale cookie in desktop navigation", () => {
  document.cookie = "aqua_facility=11111111-1111-4111-8111-111111111111; path=/";
  state.query = "facility=all";
  render(<OwnerSideNav groups={groups} />);
  expect(screen.getByRole("link", { name: "Directory" }).getAttribute("href")).toBe("/owner/members?tab=active&facility=all#list");
  expect(screen.getByRole("link", { name: "Schedule" }).getAttribute("href")).toBe("/owner/schedule?facility=all");
  expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe("/owner/sessions?facility=all");
  expect(screen.getByRole("link", { name: "Scoped fees" }).getAttribute("href")).toBe("/owner/fees?facility=22222222-2222-4222-8222-222222222222&tab=dues#top");
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
  expect(screen.getByRole("link", { name: "Login" }).getAttribute("href")).toBe("/login");
  expect(screen.getByRole("link", { name: "External" }).getAttribute("href")).toBe("https://example.com/owner/members");
});

it("carries legacy schedule location through mobile links", () => {
  state.pathname = "/owner/schedule";
  state.query = "location=22222222-2222-4222-8222-222222222222";
  const navItems: NavItem[] = [groups[0]!.items[0]!, { href: "/owner/members", label: "Members", iconName: "users" }];
  render(<OwnerMobileNav navItems={navItems} />);
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Members" }).getAttribute("href")).toBe("/owner/members?facility=22222222-2222-4222-8222-222222222222");
  fireEvent.click(within(nav).getByText("More"));
});

it("keeps explicit values, including invalid and legacy empty, without falling back", () => {
  expect(scopedOwnerNavigationHref("/owner/fees?tab=dues#top", "/owner/schedule", new URLSearchParams("location="))).toBe("/owner/fees?tab=dues&facility=all#top");
  expect(scopedOwnerNavigationHref("/owner/members", "/owner", new URLSearchParams("facility=broken"))).toBe("/owner/members?facility=broken");
  expect(scopedOwnerNavigationHref("/owner/schedule?location=", "/owner", new URLSearchParams("facility=all"))).toBe("/owner/schedule?location=");
  expect(scopedOwnerNavigationHref("/owner/settings?category=fees#x", "/owner", new URLSearchParams("facility=all"))).toBe("/owner/settings?category=fees#x");
  expect(scopedOwnerNavigationHref("/\\example.com/owner/members", "/owner", new URLSearchParams("facility=all"))).toBe("/\\example.com/owner/members");
  expect(scopedOwnerNavigationHref("/owner/members", "/owner", new URLSearchParams())).toBe("/owner/members");
});

it("carries scope into the mobile More panel", () => {
  state.pathname = "/owner";
  state.query = "facility=all";
  render(<OwnerMobileNav navItems={[groups[0]!.items[0]!]} sidebarGroups={groups} />);
  fireEvent.click(screen.getByText("More"));
  expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe("/owner/sessions?facility=all");
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
});

it("retains explicit all through Settings without adding it to the Settings URL", () => {
  state.pathname = "/owner/members";
  state.query = "facility=all";
  const Provider = (scope as unknown as { OwnerNavigationScopeProvider?: ComponentType<{ children: ReactNode }> }).OwnerNavigationScopeProvider ?? Fragment;
  const view = render(<Provider><OwnerSideNav groups={groups} /></Provider>);
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
  state.pathname = "/owner/settings";
  state.query = "";
  view.rerender(<Provider><OwnerSideNav groups={groups} /></Provider>);
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/owner?facility=all");
  view.rerender(<Provider key="another-user"><OwnerSideNav groups={groups} /></Provider>);
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/owner");
});
