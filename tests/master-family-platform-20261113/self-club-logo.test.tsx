// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/components/self-sign-out", () => ({ SelfSignOut: () => null }));
import { SelfHome } from "@/components/self-home";
afterEach(cleanup);
it("shows the scoped club logo and preserves a bounded initials fallback", () => {
  const view = { clubName: "Example Club", audience: "guardian" as const, entries: [], clubLogoUrl: "/clubs/0190c000-0000-7000-8000-000000000001/branding/logo/abc?source=guardian" };
  render(<SelfHome view={view} audience="guardian" scopeKind="self_session" tenantId="0190c000-0000-7000-8000-000000000001" />);
  const logo = screen.getByRole("img", { name: "Example Club logo" });
  expect(logo.getAttribute("src")).toContain("source=guardian");
  fireEvent.error(logo);
  expect(screen.getByRole("img", { name: "EC mark" })).toBeTruthy();
});
