// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";

afterEach(cleanup);

describe("21 November Owner brief shell gate", () => {
  it("marks the shell with the owner-only brief treatment when enabled", () => {
    render(
      <OwnerShell
        navItems={TENANT_SURFACE_NAV.owner}
        sidebarGroups={OWNER_SIDEBAR_GROUPS}
        locations={[]}
        brief
      >
        <p>Page content</p>
      </OwnerShell>,
    );
    expect(screen.getByTestId("owner-shell").hasAttribute("data-owner-brief")).toBe(true);
  });

  it("leaves every other role/shell call on the baseline treatment", () => {
    render(
      <OwnerShell
        navItems={TENANT_SURFACE_NAV.owner}
        sidebarGroups={OWNER_SIDEBAR_GROUPS}
        locations={[]}
      >
        <p>Page content</p>
      </OwnerShell>,
    );
    expect(screen.getByTestId("owner-shell").hasAttribute("data-owner-brief")).toBe(false);
  });
});
