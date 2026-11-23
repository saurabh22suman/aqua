// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/ops" }));
import { OpsNavLinks } from "@/components/ops/ops-nav-links";
afterEach(cleanup);
it("hides the disabled mock destination", () => {
  const props = { role: "admin" as const, mockMessagingAvailable: false };
  render(<OpsNavLinks {...props} />);
  expect(screen.queryByRole("link", { name: "WhatsApp mock" })).toBeNull();
  expect(screen.getByRole("link", { name: "Operators" })).toBeDefined();
});
it("retains the mock when available without granting admin links to viewers", () => {
  const props = { role: "viewer" as const, mockMessagingAvailable: true };
  render(<OpsNavLinks {...props} />);
  expect(screen.getByRole("link", { name: "WhatsApp mock" })).toBeDefined();
  expect(screen.queryByRole("link", { name: "Operators" })).toBeNull();
});
