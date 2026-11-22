// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/coach" }));
vi.mock("@/lib/offline/idb", () => ({ storedOfflineIdentity: vi.fn(async () => null), activateOfflineIdentity: vi.fn(), kvGet: vi.fn(async () => ({ count: 2 })), kvDelete: vi.fn() }));
vi.mock("@/components/pwa/connection-banner", () => ({ ConnectionBanner: () => null }));
vi.mock("@/components/pwa/install-affordance", () => ({ InstallAffordance: () => null }));
vi.mock("@/components/pwa/manifest-link", () => ({ ManifestLink: () => null }));
vi.mock("@/components/pwa/update-prompt", () => ({ UpdatePrompt: () => null }));
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
it("shows a non-sensitive count after loss", async () => {
  render(<ServiceWorkerRegistrar />);
  expect(await screen.findByText(/2.*unsynced.*(?:removed|lost)/i)).toBeTruthy();
});
