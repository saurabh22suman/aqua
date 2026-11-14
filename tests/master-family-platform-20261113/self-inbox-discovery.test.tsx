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
