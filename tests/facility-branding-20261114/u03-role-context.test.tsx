// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/owner", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/global-search", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
import { OwnerShell } from "@/components/owner-shell";
afterEach(cleanup);

it("names the current accountant role in the existing desktop and mobile club context", () => {
  render(<OwnerShell navItems={[]} locations={[]} clubName="Synthetic Club" accountLabel="Accountant"><p>Content</p></OwnerShell>);
  expect(screen.getByText("Accountant workspace")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Club and facility" })).getByText("Accountant")).toBeTruthy();
});
