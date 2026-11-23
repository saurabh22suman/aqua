// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/components/self-sign-out", () => ({ SelfSignOut: () => null }));
import { SelfHome } from "@/components/self-home";

afterEach(cleanup);
it.each([
  ["member", "/member/announcements"],
  ["guardian", "/family/announcements"],
] as const)("offers %s a discoverable announcement inbox", (audience, href) => {
  render(<SelfHome audience={audience} scopeKind="self_session" tenantId="synthetic" view={{ clubName: "Example", audience, entries: [] }} />);
  expect(screen.getByRole("link", { name: /announcements/i }).getAttribute("href")).toBe(href);
});

it.each([["member", "/member"], ["guardian", "/family"]] as const)(
  "links %s home to account and announcements near the top",
  (audience, base) => {
    render(<SelfHome audience={audience} scopeKind="self_session" tenantId="synthetic" view={{ clubName: "Example", audience, entries: [] }} />);
    const group = screen.getByRole("navigation", { name: "Workspace" });
    expect(group.querySelector('a[href="' + base + '/account"]')).toBeTruthy();
    expect(group.querySelector('a[aria-current="page"]')).toMatchObject({ textContent: "Home" });
    expect(group.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
);
