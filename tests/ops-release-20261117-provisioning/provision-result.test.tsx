// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ convert: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/platform-leads", () => ({
  convertLeadAction: mocks.convert,
  transitionLeadAction: vi.fn(),
  completeLeadAction: vi.fn(),
}));

import { LeadActions } from "@/app/(platform)/ops/leads/[leadId]/lead-actions";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows a committed tenant and warning without claiming the preset was applied", async () => {
  mocks.convert.mockResolvedValue({
    kind: "ok", tenantId: "tenant-123", preset: "swimming", presetApplied: false,
    presetWarning: "Preset failed. Apply it from the catalogue.", locationsCreated: 1,
  });
  render(<LeadActions leadId="lead-123" currentStatus="qualified" defaultSlug="test-club"
    defaultLocationName="Main" defaultPreset="swimming"
    presetOptions={[{ key: "swimming", name: "Swimming" }]} canWrite />);
  fireEvent.submit(screen.getByRole("button", { name: "Provision trial tenant" }).closest("form")!);
  await waitFor(() => expect(screen.getByText(/Preset failed/)).toBeTruthy());
  expect(document.body.textContent).not.toMatch(/tenant provisioned with preset/i);
  expect(document.body.textContent).toMatch(/preset was not applied/i);
  expect(screen.getByRole("link", { name: "Open tenant" }).getAttribute("href")).toBe("/ops/tenants/tenant-123");
});

it("states that the preset was applied when provisioning reports success", async () => {
  mocks.convert.mockResolvedValue({
    kind: "ok", tenantId: "tenant-456", preset: "swimming", presetApplied: true,
    presetWarning: null, locationsCreated: 2,
  });
  render(<LeadActions leadId="lead-456" currentStatus="qualified" defaultSlug="other-club"
    defaultLocationName="Main" defaultPreset="swimming"
    presetOptions={[{ key: "swimming", name: "Swimming" }]} canWrite />);
  fireEvent.submit(screen.getByRole("button", { name: "Provision trial tenant" }).closest("form")!);
  await waitFor(() => expect(document.body.textContent).toMatch(/preset swimming was applied/i));
  expect(screen.getByRole("link", { name: "Open tenant" }).getAttribute("href")).toBe("/ops/tenants/tenant-456");
});
