// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({usePathname:() => "/owner",useRouter:() => ({push:vi.fn(),refresh:vi.fn()}),useSearchParams:() => new URLSearchParams()}));
vi.mock("@/lib/actions/global-search", () => ({globalSearchAction:vi.fn()}));
vi.mock("@/components/tenant-sign-out", () => ({TenantSignOut:() => null}));
import { OwnerShell } from "@/components/owner-shell";
afterEach(cleanup);
it("shows the club logo in both club identity slots, separate from the account, and falls back on failure", () => {
  render(<OwnerShell navItems={[]} locations={[]} clubName="Synthetic Sports Club" accountName="Synthetic Owner" {...{clubLogoUrl:"/api/branding/tenant/logo"}}><p>Content</p></OwnerShell>);
  const logos = screen.getAllByAltText("Synthetic Sports Club logo");
  expect(logos).toHaveLength(2);
  expect(screen.getByTestId("owner-shell-account").querySelector('img[alt="Synthetic Sports Club logo"]')).toBeNull();
  fireEvent.error(logos[0]!);
  expect(screen.getAllByLabelText(/SS mark/i).length).toBeGreaterThan(0);
});
